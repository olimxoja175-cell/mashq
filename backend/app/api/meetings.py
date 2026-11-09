from __future__ import annotations

import base64
import hashlib
import hmac
import time
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ai.languages import LANGUAGES
from ..config import get_settings
from ..db import get_db
from ..models import Contact, Invitation, Meeting, MeetingParticipant, Transcript, TranslationEvent, User, utcnow
from ..realtime.hub import hub
from ..security import audit
from ..security.auth import Principal, current_principal, require
from ..security.crypto import decrypt, make_signed_token, random_token, sha256_hex
from ..serializers import invitation_dict, iso, meeting_dict, user_card

router = APIRouter(prefix="/api", tags=["meetings"])


def _aware(dt: datetime | None) -> datetime | None:
    return None if dt is None else (dt if dt.tzinfo else dt.replace(tzinfo=UTC))


async def _load_meeting(db: AsyncSession, mid: str) -> Meeting:
    m = (await db.execute(select(Meeting).where(Meeting.id == mid)
                          .execution_options(populate_existing=True))).scalar_one_or_none()
    if m is None:
        raise HTTPException(404, "Meeting not found")
    return m


def _member(m: Meeting, user_id: str) -> MeetingParticipant | None:
    return next((mp for mp in m.participants if mp.user_id == user_id), None)


async def _authorized_contact(db: AsyncSession, owner: str, other: str) -> bool:
    c = (await db.execute(select(Contact).where(Contact.owner_id == owner, Contact.contact_user_id == other))).scalar_one_or_none()
    return bool(c and c.authorized)


async def _invite(db: AsyncSession, m: Meeting, inviter: Principal, user_ids: list[str], message: str) -> list[str]:
    s = get_settings()
    created = []
    for uid in dict.fromkeys(user_ids):
        if uid == inviter.id or _member(m, uid):
            continue
        target = await db.get(User, uid)
        if target is None or not target.is_active:
            raise HTTPException(404, f"User {uid} not found")
        if not await _authorized_contact(db, inviter.id, uid):
            raise HTTPException(403, f"{target.profile.full_name} is not one of your authorized contacts")
        pending = (await db.execute(select(Invitation).where(
            Invitation.meeting_id == m.id, Invitation.invitee_id == uid, Invitation.status == "pending"))).scalar_one_or_none()
        if pending:
            continue
        token = random_token(24)
        inv = Invitation(meeting_id=m.id, inviter_id=inviter.id, invitee_id=uid, token_hash=sha256_hex(token),
                         message=message, expires_at=utcnow() + timedelta(days=s.invitation_days))
        db.add(inv)
        created.append(uid)
    return created


# ---------------- meetings ----------------
class MeetingIn(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    agenda: str = Field(default="", max_length=5000)
    scheduled_start: datetime | None = None
    scheduled_end: datetime | None = None
    security_level: Literal["standard", "confidential", "top_secret"] = "confidential"
    recording_policy: Literal["disabled", "all_consent"] = "disabled"
    invitee_ids: list[str] = Field(default_factory=list, max_length=20)
    message: str = Field(default="", max_length=1000)

    @field_validator("scheduled_end")
    @classmethod
    def _end_after_start(cls, v, info):
        start = info.data.get("scheduled_start")
        if v and start and v <= start:
            raise ValueError("End must be after start")
        return v


@router.post("/meetings")
async def create_meeting(body: MeetingIn, request: Request, p: Principal = Depends(require("meeting.create")),
                         db: AsyncSession = Depends(get_db)):
    if len(body.invitee_ids) + 1 > get_settings().max_mesh_participants:
        raise HTTPException(422, f"At most {get_settings().max_mesh_participants} participants per meeting in this deployment")
    m = Meeting(title=body.title, agenda=body.agenda, host_id=p.id, scheduled_start=body.scheduled_start,
                scheduled_end=body.scheduled_end, security_level=body.security_level,
                recording_policy=body.recording_policy, status="scheduled")
    db.add(m)
    await db.flush()
    db.add(MeetingParticipant(meeting_id=m.id, user_id=p.id, role="host"))
    await db.flush()
    m = await _load_meeting(db, m.id)
    await _invite(db, m, p, body.invitee_ids, body.message)
    await db.commit()
    await audit.record(db, "meeting.created", user_id=p.id, request=request, meeting=m.id,
                       security_level=m.security_level, invited=len(body.invitee_ids))
    return meeting_dict(await _load_meeting(db, m.id))


@router.get("/meetings")
async def list_meetings(scope: Literal["upcoming", "history", "all"] = "upcoming",
                        p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    stmt = select(Meeting).join(MeetingParticipant).where(MeetingParticipant.user_id == p.id)
    if scope == "upcoming":
        stmt = stmt.where(Meeting.status.in_(["scheduled", "live"])).order_by(Meeting.scheduled_start.asc().nulls_first())
    elif scope == "history":
        stmt = stmt.where(Meeting.status.in_(["ended", "cancelled"])).order_by(Meeting.created_at.desc())
    else:
        stmt = stmt.order_by(Meeting.created_at.desc())
    rows = (await db.execute(stmt.limit(200))).scalars().unique().all()
    return [meeting_dict(m, live_count=len(hub.room(m.id).participants) if hub.room(m.id) else 0) for m in rows]


@router.get("/meetings/{mid}")
async def get_meeting(mid: str, p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    m = await _load_meeting(db, mid)
    if not _member(m, p.id):
        raise HTTPException(404, "Meeting not found")
    room = hub.room(mid)
    out = meeting_dict(m, live_count=len(room.participants) if room else 0)
    out["my_role"] = _member(m, p.id).role
    out["recording_active"] = bool(room and room.recording_active)
    return out


class InviteIn(BaseModel):
    user_ids: list[str] = Field(min_length=1, max_length=20)
    message: str = Field(default="", max_length=1000)


@router.post("/meetings/{mid}/invite")
async def invite(mid: str, body: InviteIn, request: Request, p: Principal = Depends(require("meeting.invite")),
                 db: AsyncSession = Depends(get_db)):
    m = await _load_meeting(db, mid)
    if m.host_id != p.id:
        raise HTTPException(403, "Only the host can invite")
    if m.status in ("ended", "cancelled"):
        raise HTTPException(409, "Meeting is closed")
    created = await _invite(db, m, p, body.user_ids, body.message)
    await db.commit()
    await audit.record(db, "meeting.invited", user_id=p.id, request=request, meeting=mid, invitees=created)
    return {"invited": created}


async def _close(db: AsyncSession, m: Meeting, status: str, p: Principal, request: Request) -> dict:
    if m.host_id != p.id:
        raise HTTPException(403, "Only the host can do this")
    if m.status in ("ended", "cancelled"):
        raise HTTPException(409, "Meeting already closed")
    m.status = status
    m.ended_at = utcnow()
    for inv in (await db.execute(select(Invitation).where(Invitation.meeting_id == m.id, Invitation.status == "pending"))).scalars():
        inv.status = "revoked"
    await db.commit()
    room = hub.room(m.id)
    if room:
        await room.broadcast({"type": "meeting.ended", "by": p.id})
        for part in list(room.participants.values()):
            try:
                await part.ws.close(code=4000)
            except Exception:
                pass
    await audit.record(db, f"meeting.{status}", user_id=p.id, request=request, meeting=m.id)
    return {"ok": True, "status": status}


@router.post("/meetings/{mid}/end")
async def end_meeting(mid: str, request: Request, p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    return await _close(db, await _load_meeting(db, mid), "ended", p, request)


@router.post("/meetings/{mid}/cancel")
async def cancel_meeting(mid: str, request: Request, p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    return await _close(db, await _load_meeting(db, mid), "cancelled", p, request)


@router.get("/meetings/{mid}/transcript")
async def transcript(mid: str, request: Request, p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    """Only participants of the meeting may read its record — administrators cannot."""
    m = await _load_meeting(db, mid)
    if not _member(m, p.id):
        await audit.record(db, "transcript.access_denied", user_id=p.id, severity="warning", request=request, meeting=mid)
        raise HTTPException(404, "Meeting not found")
    rows = (await db.execute(select(Transcript).where(Transcript.meeting_id == mid).order_by(Transcript.created_at))).scalars().all()
    tevents = (await db.execute(select(TranslationEvent).where(TranslationEvent.meeting_id == mid))).scalars().all()
    by_tr: dict[str, list[TranslationEvent]] = {}
    for t in tevents:
        by_tr.setdefault(t.transcript_id, []).append(t)
    names = {mp.user_id: user_card(mp.user) for mp in m.participants}
    await audit.record(db, "transcript.read", user_id=p.id, request=request, meeting=mid)
    return {
        "meeting": meeting_dict(m),
        "entries": [{
            "id": r.id, "speaker": names.get(r.speaker_id), "language": r.source_language,
            "text": decrypt(r.text_enc, aad=mid), "confidence": r.confidence, "created_at": iso(r.created_at),
            "translations": [{"language": t.target_language, "text": decrypt(t.text_enc, aad=mid), "uncertain": t.uncertain,
                              "reason": t.uncertainty_reason, "provider": t.provider, "voice_mode": t.voice_mode,
                              "total_ms": t.total_ms} for t in by_tr.get(r.id, [])],
        } for r in rows],
    }


class TicketIn(BaseModel):
    ai_consent: bool
    spoken_language: str | None = None
    listen_language: str | None = None


def ice_servers(user_id: str) -> list[dict]:
    s = get_settings()
    servers: list[dict] = []
    if s.stun_urls:
        servers.append({"urls": s.stun_urls})
    if s.turn_urls and s.turn_secret:
        # coturn REST API credentials (use-auth-secret): short-lived, per user
        username = f"{int(time.time()) + s.turn_ttl_seconds}:{user_id}"
        cred = base64.b64encode(hmac.new(s.turn_secret.encode(), username.encode(), hashlib.sha1).digest()).decode()
        servers.append({"urls": s.turn_urls, "username": username, "credential": cred})
    return servers


@router.post("/meetings/{mid}/ticket")
async def ws_ticket(mid: str, body: TicketIn, request: Request, p: Principal = Depends(require("meeting.join")),
                    db: AsyncSession = Depends(get_db)):
    """Issues a single-use, 30-second ticket for the meeting WebSocket."""
    m = await _load_meeting(db, mid)
    mp = _member(m, p.id)
    if mp is None:
        await audit.record(db, "meeting.join_denied", user_id=p.id, severity="warning", request=request, meeting=mid)
        raise HTTPException(403, "You are not a participant of this meeting")
    if m.status in ("ended", "cancelled"):
        raise HTTPException(409, "This meeting has ended")
    for k in ("spoken_language", "listen_language"):
        v = getattr(body, k)
        if v is not None and v not in LANGUAGES:
            raise HTTPException(422, f"Unsupported language {v}")
    mp.ai_consent = body.ai_consent
    mp.spoken_language = body.spoken_language or p.user.settings.spoken_language
    mp.listen_language = body.listen_language or p.user.settings.listen_language
    await db.commit()
    token = make_signed_token("ws", f"{p.id}:{mid}", get_settings().ws_ticket_seconds)
    return {"ticket": token, "ice_servers": ice_servers(p.id), "expires_in": get_settings().ws_ticket_seconds}


# ---------------- invitations ----------------
@router.get("/invitations")
async def invitations(p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Invitation).where(or_(Invitation.invitee_id == p.id, Invitation.inviter_id == p.id))
                             .order_by(Invitation.created_at.desc()).limit(200))).scalars().all()
    now = utcnow()
    out = {"incoming": [], "sent": []}
    for i in rows:
        if i.status == "pending" and _aware(i.expires_at) < now:
            i.status = "expired"
        out["incoming" if i.invitee_id == p.id else "sent"].append(invitation_dict(i))
    await db.commit()
    return out


async def _respond(db: AsyncSession, iid: str, p: Principal, accept: bool, request: Request) -> dict:
    inv = await db.get(Invitation, iid)
    if inv is None or inv.invitee_id != p.id:
        await audit.record(db, "invitation.misuse", user_id=p.id, severity="warning", request=request, invitation=iid)
        raise HTTPException(404, "Invitation not found")
    if inv.status != "pending" or _aware(inv.expires_at) < utcnow():
        raise HTTPException(409, f"Invitation is {inv.status if inv.status != 'pending' else 'expired'}")
    m = await _load_meeting(db, inv.meeting_id)
    if m.status in ("ended", "cancelled"):
        raise HTTPException(409, "Meeting is closed")
    inv.status = "accepted" if accept else "declined"
    inv.responded_at = utcnow()
    if accept and not _member(m, p.id):
        if len(m.participants) >= get_settings().max_mesh_participants:
            raise HTTPException(409, "Meeting is full")
        db.add(MeetingParticipant(meeting_id=m.id, user_id=p.id, role="participant"))
    await db.commit()
    await audit.record(db, f"invitation.{inv.status}", user_id=p.id, request=request, meeting=m.id)
    return {"ok": True, "status": inv.status, "meeting_id": m.id}


@router.post("/invitations/{iid}/accept")
async def accept(iid: str, request: Request, p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    return await _respond(db, iid, p, True, request)


@router.post("/invitations/{iid}/decline")
async def decline(iid: str, request: Request, p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    return await _respond(db, iid, p, False, request)


@router.post("/invitations/{iid}/revoke")
async def revoke(iid: str, request: Request, p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    inv = await db.get(Invitation, iid)
    if inv is None or inv.inviter_id != p.id:
        raise HTTPException(404, "Invitation not found")
    if inv.status != "pending":
        raise HTTPException(409, "Only pending invitations can be revoked")
    inv.status = "revoked"
    inv.responded_at = utcnow()
    await db.commit()
    await audit.record(db, "invitation.revoked", user_id=p.id, request=request, invitation=iid)
    return {"ok": True}
