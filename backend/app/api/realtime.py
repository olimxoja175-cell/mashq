"""Meeting WebSocket: WebRTC signalling relay + AI translation channel.

Authentication: single-use signed ticket (POST /api/meetings/{id}/ticket), checked
for signature, expiry, meeting binding and one-time use (anti-replay). Origin is
checked against WV_ALLOWED_ORIGINS. Each client message must carry a strictly
increasing `seq`; replayed or re-ordered messages are dropped."""
from __future__ import annotations

import asyncio
import base64
import binascii
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from ..ai.languages import LANGUAGES
from ..config import get_settings
from ..db import SessionLocal
from ..models import Meeting, MeetingParticipant, User, utcnow
from ..realtime.hub import Participant, hub
from ..realtime.metrics import metrics
from ..realtime.pipeline import get_stack, process_utterance
from ..security import audit
from ..security.crypto import verify_signed_token
from ..security.ratelimit import allow, use_nonce_once
from .profile import voice_id_for

router = APIRouter()
log = logging.getLogger("worldvoice.ws")

MAX_AUDIO_BYTES = 2 * 1024 * 1024


@router.websocket("/ws/meetings/{mid}")
async def meeting_socket(ws: WebSocket, mid: str):
    s = get_settings()
    origin = ws.headers.get("origin")
    ip = ws.client.host if ws.client else ""
    if origin and origin not in s.allowed_origins:
        await ws.close(code=4403)
        return
    ticket = ws.query_params.get("ticket", "")
    verified = verify_signed_token(ticket, "ws")
    if verified is None:
        await ws.close(code=4401)
        return
    subject, nonce = verified
    user_id, _, ticket_mid = subject.partition(":")
    if ticket_mid != mid or not await use_nonce_once(f"ws:{nonce}", s.ws_ticket_seconds + 5):
        async with SessionLocal() as db:
            await audit.record(db, "ws.ticket_replay_or_mismatch", user_id=user_id, severity="critical", ip=ip, meeting=mid)
        await ws.close(code=4401)
        return

    async with SessionLocal() as db:
        meeting = (await db.execute(select(Meeting).where(Meeting.id == mid))).scalar_one_or_none()
        user = await db.get(User, user_id)
        mp = (await db.execute(select(MeetingParticipant).where(
            MeetingParticipant.meeting_id == mid, MeetingParticipant.user_id == user_id))).scalar_one_or_none()
        if meeting is None or user is None or mp is None or not user.is_active or meeting.status in ("ended", "cancelled"):
            await ws.close(code=4403)
            return
        voice_id = await voice_id_for(db, user_id) if (mp.ai_consent and user.settings.use_voice_profile) else None
        if meeting.status == "scheduled":
            meeting.status, meeting.started_at = "live", utcnow()
        mp.joined_at, mp.left_at = utcnow(), None
        await db.commit()
        room = hub.get_or_create(mid, title=meeting.title, host_id=meeting.host_id,
                                 security_level=meeting.security_level, recording_policy=meeting.recording_policy)
        prof = user.profile
        entry = f"{prof.full_name} — {prof.title}, {prof.country.name}"
        if entry not in room.glossary:
            room.glossary.append(entry)
        st = user.settings
        await audit.record(db, "meeting.joined", user_id=user_id, ip=ip, meeting=mid)

    await ws.accept()

    me = Participant(
        user_id=user_id, name=prof.full_name, title=prof.title, country=prof.country_code,
        role=mp.role, ws=ws, spoken=mp.spoken_language or st.spoken_language,
        listen=mp.listen_language or st.listen_language, auto_detect=st.auto_detect_language,
        ai_consent=mp.ai_consent, voice_id=voice_id, voice_profile_active=voice_id is not None,
    )

    # Reconnection: a newer connection for the same user replaces the old one.
    old = room.participants.get(user_id)
    if old is not None:
        try:
            await old.ws.close(code=4001)
        except Exception:
            pass
    room.participants[user_id] = me

    # A new participant pauses any active record until they consent.
    if room.recording_active and user_id not in room.recording_consents:
        room.recording_active = False
        await room.broadcast({"type": "recording.state", "active": False, "reason": "new_participant"})

    from .meetings import ice_servers

    await ws.send_json({
        "type": "welcome",
        "self": me.public(),
        "participants": [p.public() for uid, p in room.participants.items() if uid != user_id],
        "ice_servers": ice_servers(user_id),
        "ai": get_stack().status(),
        "meeting": {"id": mid, "title": room.title, "host_id": room.host_id, "security_level": room.security_level,
                    "recording_policy": room.recording_policy, "recording_active": room.recording_active},
        "reconnected": old is not None,
    })
    await room.broadcast({"type": "participant.joined", "participant": me.public(), "reconnected": old is not None},
                         exclude=user_id)
    metrics.inc("ws.connected")

    tasks: set[asyncio.Task] = set()
    try:
        while True:
            msg = await ws.receive_json()
            if not isinstance(msg, dict):
                continue
            seq = msg.get("seq")
            if not isinstance(seq, int) or seq <= me.last_seq:
                metrics.inc("ws.replay_dropped")
                continue
            me.last_seq = seq
            if not await allow(f"ws:{user_id}", 400, 10):
                await ws.send_json({"type": "error", "code": "rate_limited", "message": "Too many messages"})
                continue
            kind = msg.get("type")

            if kind == "ping":
                await room.send(user_id, {"type": "pong", "t": msg.get("t")})
                if isinstance(msg.get("rtt"), (int, float)):
                    me.rtt_ms = float(msg["rtt"])

            elif kind == "signal":
                target = msg.get("to")
                if target in room.participants and target != user_id and isinstance(msg.get("data"), dict):
                    await room.send(target, {"type": "signal", "from": user_id, "data": msg["data"]})

            elif kind == "state":
                for k in ("mic", "cam", "hand"):
                    if isinstance(msg.get(k), bool):
                        setattr(me, k, msg[k])
                await room.broadcast({"type": "participant.state", "user_id": user_id, "mic": me.mic, "cam": me.cam,
                                      "hand": me.hand}, exclude=user_id)

            elif kind == "speaking":
                await room.broadcast({"type": "speaking", "user_id": user_id, "active": bool(msg.get("active"))},
                                     exclude=user_id)

            elif kind == "lang":
                sp, li = msg.get("spoken"), msg.get("listen")
                if sp in LANGUAGES:
                    me.spoken = sp
                if li in LANGUAGES:
                    me.listen = li
                if isinstance(msg.get("auto_detect"), bool):
                    me.auto_detect = msg["auto_detect"]
                await room.broadcast({"type": "participant.lang", "user_id": user_id, "spoken": me.spoken,
                                      "listen": me.listen})

            elif kind in ("speech.text", "speech.audio"):
                uid_ = str(msg.get("utterance_id", ""))[:64]
                if not uid_:
                    continue
                kwargs = {"utterance_id": uid_, "client_ts": msg.get("client_ts")}
                if kind == "speech.text":
                    kwargs.update(text=str(msg.get("text", ""))[:2000], language=msg.get("language"),
                                  stt_confidence=msg.get("confidence") if isinstance(msg.get("confidence"), (int, float)) else None)
                else:
                    try:
                        audio = base64.b64decode(msg.get("data", ""), validate=True)
                    except (binascii.Error, ValueError):
                        continue
                    if not audio or len(audio) > MAX_AUDIO_BYTES:
                        continue
                    kwargs.update(audio=audio, mime=str(msg.get("mime", "audio/webm"))[:64])
                t = asyncio.create_task(process_utterance(room, me, **kwargs))
                tasks.add(t)
                t.add_done_callback(tasks.discard)

            elif kind == "recording.request" and user_id == room.host_id:
                if room.recording_policy != "all_consent":
                    await room.send(user_id, {"type": "error", "code": "recording_disabled",
                                              "message": "This meeting's security policy does not permit a record."})
                    continue
                room.recording_requested = True
                room.recording_consents = {user_id}
                await room.broadcast({"type": "recording.consent_request", "by": user_id}, exclude=user_id)
                await _maybe_start_recording(room)

            elif kind == "recording.consent" and room.recording_requested:
                if msg.get("accept") is True:
                    room.recording_consents.add(user_id)
                    await _maybe_start_recording(room)
                else:
                    room.recording_requested = False
                    room.recording_consents = set()
                    await room.broadcast({"type": "recording.state", "active": False, "reason": "declined",
                                          "by": user_id})

            elif kind == "recording.stop" and user_id == room.host_id:
                room.recording_active = room.recording_requested = False
                room.recording_consents = set()
                await room.broadcast({"type": "recording.state", "active": False, "reason": "stopped"})
                async with SessionLocal() as db:
                    await audit.record(db, "meeting.record_stopped", user_id=user_id, meeting=mid)

    except WebSocketDisconnect:
        pass
    except Exception as e:  # malformed JSON etc.
        log.info("ws closed: %s", e)
    finally:
        for t in tasks:
            t.cancel()
        if room.participants.get(user_id) is me:
            del room.participants[user_id]
            room.recording_consents.discard(user_id)
            await room.broadcast({"type": "participant.left", "user_id": user_id})
            async with SessionLocal() as db:
                mp2 = (await db.execute(select(MeetingParticipant).where(
                    MeetingParticipant.meeting_id == mid, MeetingParticipant.user_id == user_id))).scalar_one_or_none()
                if mp2:
                    mp2.left_at = utcnow()
                    await db.commit()
            hub.remove_if_empty(mid)
        metrics.inc("ws.disconnected")


async def _maybe_start_recording(room) -> None:
    present = set(room.participants)
    if room.recording_requested and present <= room.recording_consents:
        room.recording_active = True
        room.recording_requested = False
        await room.broadcast({"type": "recording.state", "active": True, "consented": sorted(room.recording_consents)})
        async with SessionLocal() as db:
            await audit.record(db, "meeting.record_started", user_id=room.host_id, severity="warning",
                               meeting=room.meeting_id, consented=sorted(room.recording_consents))
