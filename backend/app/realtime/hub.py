"""In-memory room registry for live meetings.

Media (audio/video) flows peer-to-peer over WebRTC (DTLS-SRTP, end-to-end between
browsers); this hub only relays signalling messages and AI translation results.
For horizontal scaling, rooms must be pinned to one node (sticky routing by meeting
id) or the hub replaced with a Redis pub/sub implementation of the same interface."""
from __future__ import annotations

import asyncio
import time
from collections import deque
from dataclasses import dataclass, field

from fastapi import WebSocket


@dataclass
class Participant:
    user_id: str
    name: str
    title: str
    country: str
    role: str
    ws: WebSocket
    spoken: str
    listen: str
    auto_detect: bool = True
    ai_consent: bool = False
    voice_id: str | None = None  # provider voice id of THIS user's consented profile only
    voice_profile_active: bool = False
    mic: bool = True
    cam: bool = True
    hand: bool = False
    last_seq: int = 0
    connected_at: float = field(default_factory=time.time)
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    rtt_ms: float | None = None

    def public(self) -> dict:
        return {
            "user_id": self.user_id,
            "name": self.name,
            "title": self.title,
            "country": self.country,
            "role": self.role,
            "spoken": self.spoken,
            "listen": self.listen,
            "mic": self.mic,
            "cam": self.cam,
            "ai_consent": self.ai_consent,
            "voice_profile": self.voice_profile_active,
        }


@dataclass
class Room:
    meeting_id: str
    title: str
    host_id: str
    security_level: str
    recording_policy: str
    participants: dict[str, Participant] = field(default_factory=dict)
    context: deque = field(default_factory=lambda: deque(maxlen=12))  # (lang, text)
    speaker_locks: dict[str, asyncio.Lock] = field(default_factory=dict)
    seen_utterances: deque = field(default_factory=lambda: deque(maxlen=500))
    recording_active: bool = False
    recording_consents: set[str] = field(default_factory=set)
    recording_requested: bool = False
    glossary: list[str] = field(default_factory=list)

    def lock_for(self, user_id: str) -> asyncio.Lock:
        return self.speaker_locks.setdefault(user_id, asyncio.Lock())

    def mark_seen(self, key: str) -> bool:
        """True if the utterance is new; False if it is a duplicate (never re-translate)."""
        if key in self.seen_utterances:
            return False
        self.seen_utterances.append(key)
        return True

    async def send(self, user_id: str, message: dict) -> None:
        p = self.participants.get(user_id)
        if p is None:
            return
        try:
            async with p.send_lock:
                await p.ws.send_json(message)
        except Exception:
            pass

    async def broadcast(self, message: dict, exclude: str | None = None) -> None:
        await asyncio.gather(
            *(self.send(uid, message) for uid in list(self.participants) if uid != exclude)
        )


class Hub:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}
        self.started = time.time()

    def room(self, meeting_id: str) -> Room | None:
        return self.rooms.get(meeting_id)

    def get_or_create(self, meeting_id: str, **kw) -> Room:
        if meeting_id not in self.rooms:
            self.rooms[meeting_id] = Room(meeting_id=meeting_id, **kw)
        return self.rooms[meeting_id]

    def remove_if_empty(self, meeting_id: str) -> None:
        r = self.rooms.get(meeting_id)
        if r and not r.participants:
            del self.rooms[meeting_id]

    def stats(self) -> dict:
        return {
            "rooms": len(self.rooms),
            "connections": sum(len(r.participants) for r in self.rooms.values()),
            "uptime_s": int(time.time() - self.started),
        }


hub = Hub()
