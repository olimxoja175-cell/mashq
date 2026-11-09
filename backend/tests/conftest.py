"""Integration test harness: boots a real uvicorn server (isolated SQLite DB, dev
mode, no external AI keys) in a background thread. Tests talk to it like browsers
do — HTTP with cookies + WebSockets — so multi-user meetings are exercised end to end."""
from __future__ import annotations

import asyncio
import json
import os
import socket
import tempfile
import threading
import time
import uuid

import httpx
import pytest
import websockets

_tmp = tempfile.mkdtemp(prefix="wv-test-")
os.environ.update({
    "WV_DEV_MODE": "true",
    "WV_DATABASE_URL": f"sqlite+aiosqlite:///{_tmp}/test.db",
    "WV_LOGIN_IP_LIMIT": "500",
    "WV_ALLOWED_ORIGINS": '["http://localhost:3000"]',
    "ANTHROPIC_API_KEY": "", "OPENAI_API_KEY": "", "ELEVENLABS_API_KEY": "", "GEMINI_API_KEY": "",
})

import uvicorn  # noqa: E402

from app.main import app  # noqa: E402


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


PORT = _free_port()
BASE = f"http://127.0.0.1:{PORT}"
WS_BASE = f"ws://127.0.0.1:{PORT}"
PASSWORD = "WorldVoice#2026"
USERS = {
    "uz": "uz.president@demo.worldvoice",
    "zh": "cn.president@demo.worldvoice",
    "en": "gb.pm@demo.worldvoice",
    "ar": "eg.president@demo.worldvoice",
    "fr": "fr.minister@demo.worldvoice",
    "sec": "security@demo.worldvoice",
    "admin": "admin@demo.worldvoice",
}


@pytest.fixture(scope="session", autouse=True)
def server():
    config = uvicorn.Config(app, host="127.0.0.1", port=PORT, log_level="warning", ws="websockets")
    srv = uvicorn.Server(config)
    t = threading.Thread(target=srv.run, daemon=True)
    t.start()
    for _ in range(100):
        try:
            if httpx.get(f"{BASE}/api/health", timeout=1).status_code == 200:
                break
        except httpx.HTTPError:
            time.sleep(0.1)
    yield srv
    srv.should_exit = True
    t.join(timeout=5)


class Client:
    """A signed-in official: HTTP session + helpers."""

    def __init__(self, key: str, http: httpx.AsyncClient, me: dict):
        self.key, self.http, self.me = key, http, me
        self.id = me["id"]

    async def get(self, path, **kw):
        return await self.http.get(path, **kw)

    async def post(self, path, json_body=None, **kw):
        return await self.http.post(path, json=json_body, headers={"X-WV-Request": "1"}, **kw)

    async def put(self, path, json_body=None):
        return await self.http.put(path, json=json_body, headers={"X-WV-Request": "1"})

    async def patch(self, path, json_body=None):
        return await self.http.patch(path, json=json_body, headers={"X-WV-Request": "1"})

    async def delete(self, path):
        return await self.http.delete(path, headers={"X-WV-Request": "1"})


async def sign_in(key: str) -> Client:
    http = httpx.AsyncClient(base_url=BASE, timeout=20)
    r = await http.post("/api/auth/login", json={"email": USERS[key], "password": PASSWORD}, headers={"X-WV-Request": "1"})
    assert r.status_code == 200, r.text
    body = r.json()
    r = await http.post("/api/auth/verify", json={"challenge_id": body["challenge_id"], "code": body["dev_code"]},
                        headers={"X-WV-Request": "1"})
    assert r.status_code == 200, r.text
    return Client(key, http, r.json()["user"])


_clients: dict[str, Client] = {}


@pytest.fixture
async def login():
    async def _login(key: str) -> Client:
        # Each pytest-asyncio test runs in its own loop, so reuse cookies, not clients.
        if key in _clients:
            http = httpx.AsyncClient(base_url=BASE, timeout=20, cookies=_clients[key].http.cookies)
            c = Client(key, http, _clients[key].me)
            if (await c.get("/api/auth/me")).status_code == 200:
                return c
        c = await sign_in(key)
        _clients[key] = c
        return c

    return _login


class WSPeer:
    def __init__(self, ws, welcome: dict):
        self.ws, self.welcome, self.seq = ws, welcome, 0
        self.inbox: list[dict] = []

    async def send(self, msg: dict) -> None:
        self.seq += 1
        await self.ws.send(json.dumps({**msg, "seq": self.seq}))

    async def recv_until(self, pred, timeout: float = 5.0) -> dict:
        for m in self.inbox:
            if pred(m):
                self.inbox.remove(m)
                return m
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("expected message not received")
            m = json.loads(await asyncio.wait_for(self.ws.recv(), remaining))
            if pred(m):
                return m
            self.inbox.append(m)

    async def drain(self, seconds: float = 0.5) -> list[dict]:
        end = time.monotonic() + seconds
        while (left := end - time.monotonic()) > 0:
            try:
                self.inbox.append(json.loads(await asyncio.wait_for(self.ws.recv(), left)))
            except (TimeoutError, asyncio.TimeoutError):
                break
        out, self.inbox = self.inbox, []
        return out


async def join(client: Client, meeting_id: str, *, spoken: str, listen: str | None = None, consent: bool = True) -> WSPeer:
    r = await client.post(f"/api/meetings/{meeting_id}/ticket",
                          {"ai_consent": consent, "spoken_language": spoken, "listen_language": listen or spoken})
    assert r.status_code == 200, r.text
    ws = await websockets.connect(f"{WS_BASE}/ws/meetings/{meeting_id}?ticket={r.json()['ticket']}",
                                  origin="http://localhost:3000")
    welcome = json.loads(await ws.recv())
    assert welcome["type"] == "welcome"
    return WSPeer(ws, welcome)


async def new_meeting(host: Client, invitees: list[Client], **kw) -> str:
    r = await host.post("/api/meetings", {"title": kw.pop("title", f"Test {uuid.uuid4().hex[:6]}"),
                                          "invitee_ids": [c.id for c in invitees], **kw})
    assert r.status_code == 200, r.text
    mid = r.json()["id"]
    for c in invitees:
        inv = (await c.get("/api/invitations")).json()["incoming"]
        iid = next(i["id"] for i in inv if i["meeting"]["id"] == mid)
        assert (await c.post(f"/api/invitations/{iid}/accept")).status_code == 200
    return mid
