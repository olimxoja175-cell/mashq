"""Requirement tests 10, 11 + security architecture checks."""
from __future__ import annotations

import json

import httpx
import pytest
import websockets
import websockets.exceptions

from .conftest import BASE, PASSWORD, USERS, WS_BASE, join, new_meeting

H = {"X-WV-Request": "1"}
REJECTED = (websockets.exceptions.ConnectionClosed, websockets.exceptions.InvalidStatus)


async def test_unauthenticated_requests_rejected():
    async with httpx.AsyncClient(base_url=BASE) as c:
        for path in ("/api/auth/me", "/api/meetings", "/api/contacts", "/api/admin/users", "/api/admin/monitoring"):
            assert (await c.get(path)).status_code == 401, path


async def test_csrf_header_required(login):
    uz = await login("uz")
    r = await uz.http.post("/api/meetings", json={"title": "No header"})
    assert r.status_code == 403


async def test_wrong_password_and_lockout(login):
    admin = await login("admin")
    r = await admin.post("/api/admin/users", {
        "email": "lockout@demo.worldvoice", "password": "Sufficiently#Strong1", "full_name": "Lock Test",
        "title": "Ambassador", "country_code": "UZ", "language": "uz", "role_id": "diplomat"})
    assert r.status_code == 200, r.text
    async with httpx.AsyncClient(base_url=BASE) as c:
        for _ in range(5):
            r = await c.post("/api/auth/login", json={"email": "lockout@demo.worldvoice", "password": "wrong"}, headers=H)
            assert r.status_code == 401
        r = await c.post("/api/auth/login", json={"email": "lockout@demo.worldvoice", "password": "Sufficiently#Strong1"}, headers=H)
        assert r.status_code == 423  # locked even with the right password


async def test_mfa_wrong_code_and_totp_replay():
    async with httpx.AsyncClient(base_url=BASE) as c:
        r = await c.post("/api/auth/login", json={"email": USERS["fr"], "password": PASSWORD}, headers=H)
        ch = r.json()
        assert (await c.post("/api/auth/verify", json={"challenge_id": ch["challenge_id"], "code": "000000"}, headers=H)).status_code == 401
        ok = await c.post("/api/auth/verify", json={"challenge_id": ch["challenge_id"], "code": ch["dev_code"]}, headers=H)
        assert ok.status_code == 200
        # The same challenge cannot be reused
        again = await c.post("/api/auth/verify", json={"challenge_id": ch["challenge_id"], "code": ch["dev_code"]}, headers=H)
        assert again.status_code == 401
    async with httpx.AsyncClient(base_url=BASE) as c2:
        r = await c2.post("/api/auth/login", json={"email": USERS["fr"], "password": PASSWORD}, headers=H)
        # replaying the already-used code on a fresh challenge fails (anti-replay)
        bad = await c2.post("/api/auth/verify", json={"challenge_id": r.json()["challenge_id"], "code": ch["dev_code"]}, headers=H)
        assert bad.status_code == 401


async def test_rbac(login):
    admin, sec, uz = await login("admin"), await login("sec"), await login("uz")
    # security officer cannot manage users; official cannot see admin pages
    assert (await sec.get("/api/admin/users")).status_code == 403
    assert (await uz.get("/api/admin/monitoring")).status_code == 403
    assert (await sec.get("/api/admin/monitoring")).status_code == 200
    # administrators are separated from meetings by default
    assert (await admin.post("/api/meetings", {"title": "Admin meeting"})).status_code == 403
    # access management lists roles; the denial events were audited
    roles = (await admin.get("/api/admin/roles")).json()
    assert {r["id"] for r in roles["roles"]} >= {"head_of_state", "admin", "delegate"}
    log = (await admin.get("/api/admin/audit?event=access.denied")).json()
    assert log["events"] and log["chain_valid"] is True


async def test_invitation_flow(login):
    """Test 10."""
    uz, zh, en = await login("uz"), await login("zh"), await login("en")
    r = await uz.post("/api/meetings", {"title": "Bilateral talks", "invitee_ids": [zh.id, en.id],
                                        "scheduled_start": "2030-01-10T09:00:00Z", "scheduled_end": "2030-01-10T10:00:00Z"})
    assert r.status_code == 200
    mid = r.json()["id"]
    zh_inv = next(i for i in (await zh.get("/api/invitations")).json()["incoming"] if i["meeting"]["id"] == mid)
    en_inv = next(i for i in (await en.get("/api/invitations")).json()["incoming"] if i["meeting"]["id"] == mid)
    # another official cannot accept someone else's invitation
    assert (await en.post(f"/api/invitations/{zh_inv['id']}/accept")).status_code == 404
    assert (await zh.post(f"/api/invitations/{zh_inv['id']}/accept")).json()["status"] == "accepted"
    assert (await zh.post(f"/api/invitations/{zh_inv['id']}/accept")).status_code == 409
    assert (await en.post(f"/api/invitations/{en_inv['id']}/decline")).json()["status"] == "declined"
    m = (await zh.get(f"/api/meetings/{mid}")).json()
    assert {p["id"] for p in m["participants"]} == {uz.id, zh.id}
    assert (await en.get(f"/api/meetings/{mid}")).status_code == 404
    upcoming = (await zh.get("/api/meetings?scope=upcoming")).json()
    assert any(x["id"] == mid for x in upcoming)


async def test_only_authorized_contacts_can_be_invited(login):
    uz, sec = await login("uz"), await login("sec")
    r = await uz.post("/api/meetings", {"title": "Not allowed", "invitee_ids": [sec.id]})
    assert r.status_code == 403
    # revoking authorization blocks invitations
    zh = await login("zh")
    contact = next(c for c in (await uz.get("/api/contacts")).json() if c["user"]["id"] == zh.id)
    assert (await uz.patch(f"/api/contacts/{contact['id']}", {"authorized": False})).status_code == 200
    assert (await uz.post("/api/meetings", {"title": "Blocked", "invitee_ids": [zh.id]})).status_code == 403
    await uz.patch(f"/api/contacts/{contact['id']}", {"authorized": True})


async def test_non_participant_cannot_join_or_read(login):
    uz, zh, en, admin = await login("uz"), await login("zh"), await login("en"), await login("admin")
    mid = await new_meeting(uz, [zh])
    r = await en.post(f"/api/meetings/{mid}/ticket", {"ai_consent": True})
    assert r.status_code == 403
    assert (await en.get(f"/api/meetings/{mid}/transcript")).status_code == 404
    # administrators cannot read transcripts either
    assert (await admin.get(f"/api/meetings/{mid}/transcript")).status_code == 404


async def test_ws_ticket_single_use_and_bound(login):
    uz, zh = await login("uz"), await login("zh")
    mid = await new_meeting(uz, [zh])
    other = await new_meeting(uz, [zh])
    t = (await uz.post(f"/api/meetings/{mid}/ticket", {"ai_consent": True})).json()["ticket"]
    # bound to its meeting
    with pytest.raises(REJECTED):
        async with websockets.connect(f"{WS_BASE}/ws/meetings/{other}?ticket={t}") as ws:
            await ws.recv()
    t2 = (await uz.post(f"/api/meetings/{mid}/ticket", {"ai_consent": True})).json()["ticket"]
    async with websockets.connect(f"{WS_BASE}/ws/meetings/{mid}?ticket={t2}") as ws:
        assert json.loads(await ws.recv())["type"] == "welcome"
    # replay of a used ticket
    with pytest.raises(REJECTED):
        async with websockets.connect(f"{WS_BASE}/ws/meetings/{mid}?ticket={t2}") as ws:
            await ws.recv()
    # forged ticket
    with pytest.raises(REJECTED):
        async with websockets.connect(f"{WS_BASE}/ws/meetings/{mid}?ticket=ws.x:{mid}.9999999999.n.deadbeef") as ws:
            await ws.recv()
    # foreign origin
    t3 = (await uz.post(f"/api/meetings/{mid}/ticket", {"ai_consent": True})).json()["ticket"]
    with pytest.raises(REJECTED):
        async with websockets.connect(f"{WS_BASE}/ws/meetings/{mid}?ticket={t3}", origin="https://evil.example") as ws:
            await ws.recv()


async def test_meeting_end_closes_room(login):
    uz, zh = await login("uz"), await login("zh")
    mid = await new_meeting(uz, [zh])
    pb = await join(zh, mid, spoken="zh")
    assert (await zh.post(f"/api/meetings/{mid}/end")).status_code == 403  # only host
    assert (await uz.post(f"/api/meetings/{mid}/end")).status_code == 200
    m = await pb.recv_until(lambda m: m["type"] == "meeting.ended")
    assert m["by"] == uz.id
    assert (await zh.post(f"/api/meetings/{mid}/ticket", {"ai_consent": True})).status_code == 409


async def test_recording_requires_everyone_and_is_encrypted(login):
    uz, zh = await login("uz"), await login("zh")
    # policy disabled -> request refused
    mid0 = await new_meeting(uz, [zh])
    p0 = await join(uz, mid0, spoken="uz")
    await p0.send({"type": "recording.request"})
    assert (await p0.recv_until(lambda m: m["type"] == "error"))["code"] == "recording_disabled"
    await p0.ws.close()

    mid = await new_meeting(uz, [zh], recording_policy="all_consent")
    pa, pb = await join(uz, mid, spoken="uz"), await join(zh, mid, spoken="zh")
    try:
        await pa.send({"type": "recording.request"})
        await pb.recv_until(lambda m: m["type"] == "recording.consent_request")
        await pb.send({"type": "recording.consent", "accept": True})
        st = await pa.recv_until(lambda m: m["type"] == "recording.state")
        assert st["active"] is True
        await pa.send({"type": "speech.text", "utterance_id": "rec-1", "text": "Rahmat. Xayr.", "language": "uz"})
        await pb.recv_until(lambda m: m["type"] == "translation")
        import asyncio
        await asyncio.sleep(0.3)
        tr = (await zh.get(f"/api/meetings/{mid}/transcript")).json()
        assert tr["entries"][0]["text"] == "Rahmat. Xayr."
        assert tr["entries"][0]["translations"][0]["text"] == "谢谢。再见。"
        # stored encrypted at rest
        import sqlite3, os
        db = os.environ["WV_DATABASE_URL"].split("///")[1]
        raw = sqlite3.connect(db).execute("select text_enc from transcripts where utterance_id='rec-1'").fetchone()[0]
        assert "Rahmat" not in raw and raw.startswith("v1:")
    finally:
        await pa.ws.close(); await pb.ws.close()


async def test_voice_enrollment_safeguards(login):
    uz = await login("uz")
    files = {"samples": ("s.webm", b"\x1aE\xdf\xa3" + b"0" * 100, "audio/webm")}
    r = await uz.http.post("/api/voice/enroll", headers=H, files=files,
                           data={"consent": "true", "signed_name": "Somebody Else", "sample_seconds": "45"})
    assert r.status_code == 403  # signature must match the verified official
    r = await uz.http.post("/api/voice/enroll", headers=H, files=files,
                           data={"consent": "true", "signed_name": uz.me["name"], "sample_seconds": "45"})
    assert r.status_code == 503  # no cloning provider configured: honest refusal, nothing faked
    assert (await uz.get("/api/voice/profile")).json()["status"] == "none"


async def test_session_revocation_and_logout(login):
    en = await login("en")
    sessions = (await en.get("/api/auth/sessions")).json()
    assert any(s["current"] for s in sessions)
    async with httpx.AsyncClient(base_url=BASE, cookies=en.http.cookies) as c:
        assert (await c.post("/api/auth/logout", headers=H)).status_code == 200
        assert (await c.get("/api/auth/me")).status_code == 401
    from .conftest import _clients
    _clients.pop("en", None)


async def test_languages_rtl_metadata():
    """Test 13 (API side): Arabic and Persian flagged RTL; 14 languages available."""
    async with httpx.AsyncClient(base_url=BASE) as c:
        langs = (await c.get("/api/languages")).json()
    assert len(langs) == 14
    assert {l["code"] for l in langs if l["rtl"]} == {"ar", "fa"}


async def test_audit_chain_detects_tampering(login):
    admin = await login("admin")
    assert (await admin.get("/api/admin/audit")).json()["chain_valid"] is True
    import os, sqlite3
    db = os.environ["WV_DATABASE_URL"].split("///")[1]
    con = sqlite3.connect(db)
    row = con.execute("select id, details from security_events order by id limit 1 offset 3").fetchone()
    con.execute("update security_events set details=? where id=?", ('{"tampered": true}', row[0]))
    con.commit()
    assert (await admin.get("/api/admin/audit")).json()["chain_valid"] is False
    con.execute("update security_events set details=? where id=?", (row[1], row[0]))
    con.commit()
    assert (await admin.get("/api/admin/audit")).json()["chain_valid"] is True


async def test_monitoring_reports_latency(login):
    sec = await login("sec")
    m = (await sec.get("/api/admin/monitoring")).json()
    assert m["database"]["ok"] and m["ai"]["translation"]["simulated"] is True
    assert m["latency"]["total_ms"]["count"] > 0
