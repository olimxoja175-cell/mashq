"""Administration. Administrators manage identities, roles and infrastructure —
they deliberately have NO endpoint that returns meeting transcripts, translated
text or voice-profile material."""
from __future__ import annotations

import time

import pyotp
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..ai.languages import LANGUAGES
from ..config import get_settings
from ..db import get_db
from ..models import (
    AuthSession,
    Country,
    Meeting,
    OfficialProfile,
    Permission,
    Role,
    SecurityEvent,
    User,
    UserSettings,
    VoiceProfile,
    utcnow,
)
from ..realtime.hub import hub
from ..realtime.metrics import metrics
from ..realtime.pipeline import get_stack
from ..security import audit
from ..security.auth import Principal, hash_password, new_totp_secret, require, validate_password_strength
from ..serializers import iso, user_card

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _aware(dt):
    from datetime import UTC

    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _admin_user(u: User, active_sessions: int = 0) -> dict:
    return {**user_card(u), "email": u.email, "is_active": u.is_active, "role": u.role_id,
            "locked": bool(u.locked_until and _aware(u.locked_until) > utcnow()),
            "last_login_at": iso(u.last_login_at), "created_at": iso(u.created_at), "active_sessions": active_sessions}


@router.get("/users")
async def users(p: Principal = Depends(require("admin.users")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(User).order_by(User.created_at))).scalars().all()
    counts = dict((await db.execute(
        select(AuthSession.user_id, func.count()).where(AuthSession.revoked_at.is_(None)).group_by(AuthSession.user_id)
    )).all())
    return [_admin_user(u, counts.get(u.id, 0)) for u in rows]


class NewUserIn(BaseModel):
    email: EmailStr
    password: str
    full_name: str = Field(min_length=2, max_length=160)
    title: str = Field(min_length=2, max_length=160)
    organization: str = ""
    country_code: str = Field(min_length=2, max_length=2)
    language: str = "en"
    role_id: str = "diplomat"


@router.post("/users")
async def create_user(body: NewUserIn, request: Request, p: Principal = Depends(require("admin.users")),
                      db: AsyncSession = Depends(get_db)):
    validate_password_strength(body.password)
    if body.language not in LANGUAGES:
        raise HTTPException(422, "Unsupported language")
    if await db.get(Role, body.role_id) is None:
        raise HTTPException(422, "Unknown role")
    if body.role_id == "admin" and not p.can("admin.access"):
        raise HTTPException(403, "Only access managers can create administrators")
    if await db.get(Country, body.country_code.upper()) is None:
        raise HTTPException(422, "Unknown country")
    if (await db.execute(select(User).where(User.email == body.email.lower()))).scalar_one_or_none():
        raise HTTPException(409, "Email already registered")
    secret, enc = new_totp_secret()
    u = User(email=body.email.lower(), password_hash=hash_password(body.password), totp_secret_enc=enc, role_id=body.role_id)
    db.add(u)
    await db.flush()
    db.add(OfficialProfile(user_id=u.id, full_name=body.full_name, title=body.title, organization=body.organization,
                           country_code=body.country_code.upper()))
    db.add(UserSettings(user_id=u.id, spoken_language=body.language, listen_language=body.language, ui_language=body.language))
    await db.commit()
    await audit.record(db, "admin.user_created", user_id=p.id, severity="warning", request=request, target=u.id,
                       role=body.role_id)
    return {"id": u.id, "totp_secret": secret,
            "otpauth_uri": pyotp.TOTP(secret).provisioning_uri(name=u.email, issuer_name="WORLDVOICE"),
            "note": "Deliver the authenticator secret to the official through a separate secure channel. It is shown only once."}


class UserPatch(BaseModel):
    is_active: bool | None = None
    role_id: str | None = None
    identity_verified: bool | None = None


@router.patch("/users/{uid}")
async def patch_user(uid: str, body: UserPatch, request: Request, p: Principal = Depends(require("admin.users")),
                     db: AsyncSession = Depends(get_db)):
    u = await db.get(User, uid)
    if u is None:
        raise HTTPException(404, "User not found")
    changes = body.model_dump(exclude_none=True)
    if "role_id" in changes:
        if not p.can("admin.access"):
            raise HTTPException(403, "Changing roles requires access-management permission")
        if await db.get(Role, body.role_id) is None:
            raise HTTPException(422, "Unknown role")
        if uid == p.id:
            raise HTTPException(409, "You cannot change your own role")
        u.role_id = body.role_id
    if body.is_active is not None:
        if uid == p.id and not body.is_active:
            raise HTTPException(409, "You cannot deactivate yourself")
        u.is_active = body.is_active
        if not body.is_active:
            for s in (await db.execute(select(AuthSession).where(AuthSession.user_id == uid, AuthSession.revoked_at.is_(None)))).scalars():
                s.revoked_at = utcnow()
    if body.identity_verified is not None:
        u.profile.identity_verified = body.identity_verified
        u.profile.verified_at = utcnow() if body.identity_verified else None
        u.profile.verified_by = p.id if body.identity_verified else None
    await db.commit()
    await audit.record(db, "admin.user_updated", user_id=p.id, severity="warning", request=request, target=uid, changes=changes)
    await db.refresh(u)
    return _admin_user(u)


@router.post("/users/{uid}/revoke-sessions")
async def revoke_sessions(uid: str, request: Request, p: Principal = Depends(require("admin.users")),
                          db: AsyncSession = Depends(get_db)):
    n = 0
    for s in (await db.execute(select(AuthSession).where(AuthSession.user_id == uid, AuthSession.revoked_at.is_(None)))).scalars():
        s.revoked_at = utcnow()
        n += 1
    await db.commit()
    await audit.record(db, "admin.sessions_revoked", user_id=p.id, severity="warning", request=request, target=uid, count=n)
    return {"revoked": n}


@router.post("/users/{uid}/reset-mfa")
async def reset_mfa(uid: str, request: Request, p: Principal = Depends(require("admin.users")), db: AsyncSession = Depends(get_db)):
    u = await db.get(User, uid)
    if u is None:
        raise HTTPException(404, "User not found")
    secret, enc = new_totp_secret()
    u.totp_secret_enc, u.totp_last_step = enc, 0
    for s in (await db.execute(select(AuthSession).where(AuthSession.user_id == uid, AuthSession.revoked_at.is_(None)))).scalars():
        s.revoked_at = utcnow()
    await db.commit()
    await audit.record(db, "admin.mfa_reset", user_id=p.id, severity="critical", request=request, target=uid)
    return {"totp_secret": secret, "otpauth_uri": pyotp.TOTP(secret).provisioning_uri(name=u.email, issuer_name="WORLDVOICE")}


# ---------------- access management ----------------
@router.get("/roles")
async def roles(p: Principal = Depends(require("admin.access")), db: AsyncSession = Depends(get_db)):
    rs = (await db.execute(select(Role).order_by(Role.id))).scalars().all()
    perms = (await db.execute(select(Permission).order_by(Permission.code))).scalars().all()
    counts = dict((await db.execute(select(User.role_id, func.count()).group_by(User.role_id))).all())
    return {
        "roles": [{"id": r.id, "name": r.name, "description": r.description, "users": counts.get(r.id, 0),
                   "permissions": sorted(x.code for x in r.permissions)} for r in rs],
        "permissions": [{"code": x.code, "description": x.description} for x in perms],
    }


class RolePermsIn(BaseModel):
    permissions: list[str]


@router.put("/roles/{rid}/permissions")
async def set_role_permissions(rid: str, body: RolePermsIn, request: Request, p: Principal = Depends(require("admin.access")),
                               db: AsyncSession = Depends(get_db)):
    r = await db.get(Role, rid)
    if r is None:
        raise HTTPException(404, "Role not found")
    if rid == p.user.role_id and "admin.access" not in body.permissions:
        raise HTTPException(409, "You cannot remove access management from your own role")
    perms = (await db.execute(select(Permission).where(Permission.code.in_(body.permissions)))).scalars().all()
    if len(perms) != len(set(body.permissions)):
        raise HTTPException(422, "Unknown permission code")
    r.permissions = list(perms)
    await db.commit()
    await audit.record(db, "admin.role_permissions_changed", user_id=p.id, severity="critical", request=request,
                       role=rid, permissions=sorted(body.permissions))
    return {"ok": True}


# ---------------- audit ----------------
@router.get("/audit")
async def audit_log(limit: int = 200, event: str = "", p: Principal = Depends(require("audit.read")),
                    db: AsyncSession = Depends(get_db)):
    stmt = select(SecurityEvent).order_by(SecurityEvent.id.desc()).limit(min(limit, 1000))
    if event:
        stmt = stmt.where(SecurityEvent.event_type.like(f"{event}%"))
    rows = (await db.execute(stmt)).scalars().all()
    ok, n = await audit.verify_chain(db)
    return {"chain_valid": ok, "checked": n, "events": [{
        "id": e.id, "type": e.event_type, "severity": e.severity, "user_id": e.user_id, "ip": e.ip,
        "details": e.details, "created_at": iso(e.created_at), "hash": e.hash[:16]} for e in rows]}


# ---------------- monitoring ----------------
@router.get("/monitoring")
async def monitoring(p: Principal = Depends(require("system.monitor")), db: AsyncSession = Depends(get_db)):
    t0 = time.perf_counter()
    db_ok = True
    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        db_ok = False
    db_ms = round((time.perf_counter() - t0) * 1000, 1)
    s = get_settings()
    since = utcnow().replace(microsecond=0)
    failed = (await db.execute(select(func.count()).select_from(SecurityEvent).where(
        SecurityEvent.event_type.in_(["auth.login_failed", "auth.mfa_failed"])))).scalar()
    denied = (await db.execute(select(func.count()).select_from(SecurityEvent).where(
        SecurityEvent.event_type.like("%denied%")))).scalar()
    critical = (await db.execute(select(func.count()).select_from(SecurityEvent).where(SecurityEvent.severity == "critical"))).scalar()
    return {
        "time": iso(since),
        "dev_mode": s.dev_mode,
        "database": {"ok": db_ok, "latency_ms": db_ms, "backend": s.database_url.split(":")[0]},
        "redis": {"configured": bool(s.redis_url)},
        "realtime": hub.stats(),
        "live_rooms": [{"meeting_id": r.meeting_id, "title": r.title, "participants": len(r.participants),
                        "security_level": r.security_level, "recording_active": r.recording_active}
                       for r in hub.rooms.values()],
        "ai": get_stack().status(),
        "latency": metrics.summary(),
        "security": {"failed_auth_events": failed, "access_denied_events": denied, "critical_events": critical},
        "counts": {
            "users": (await db.execute(select(func.count()).select_from(User))).scalar(),
            "meetings": (await db.execute(select(func.count()).select_from(Meeting))).scalar(),
            "live_meetings": (await db.execute(select(func.count()).select_from(Meeting).where(Meeting.status == "live"))).scalar(),
            "voice_profiles": (await db.execute(select(func.count()).select_from(VoiceProfile).where(VoiceProfile.status == "active"))).scalar(),
        },
        "webrtc": {"stun": bool(s.stun_urls), "turn": bool(s.turn_urls and s.turn_secret),
                   "max_mesh_participants": s.max_mesh_participants},
    }
