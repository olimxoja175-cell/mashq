from __future__ import annotations

from datetime import UTC, timedelta

import pyotp
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db
from ..models import AuthSession, MfaChallenge, User, utcnow
from ..security import audit
from ..security.auth import (
    SESSION_COOKIE,
    Principal,
    check_totp,
    create_session,
    current_principal,
    hash_password,
    new_totp_secret,
    totp_for,
    validate_password_strength,
    verify_password,
)
from ..security.ratelimit import allow
from ..serializers import iso, me_dict

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class VerifyIn(BaseModel):
    challenge_id: str
    code: str = Field(min_length=6, max_length=8)


def _aware(dt):
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


@router.post("/login")
async def login(body: LoginIn, request: Request, db: AsyncSession = Depends(get_db)):
    s = get_settings()
    ip = request.client.host if request.client else "?"
    email = body.email.lower()
    if not await allow(f"login:ip:{ip}", s.login_ip_limit, 300) or not await allow(f"login:acct:{email}", 10, 300):
        await audit.record(db, "auth.rate_limited", severity="warning", request=request, email=email)
        raise HTTPException(429, "Too many attempts. Try again later.")

    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    now = utcnow()
    if user and user.locked_until and _aware(user.locked_until) > now:
        await audit.record(db, "auth.login_locked", user_id=user.id, severity="warning", request=request)
        raise HTTPException(423, "Account temporarily locked after repeated failures.")

    ok = verify_password(user.password_hash if user else None, body.password)
    if not ok or not user or not user.is_active:
        if user:
            user.failed_logins += 1
            if user.failed_logins >= s.max_failed_logins:
                user.locked_until = now + timedelta(minutes=s.lockout_minutes)
                user.failed_logins = 0
            await db.commit()
        await audit.record(db, "auth.login_failed", user_id=user.id if user else None, severity="warning",
                           request=request, email=email)
        raise HTTPException(401, "Invalid credentials")

    ch = MfaChallenge(user_id=user.id, expires_at=now + timedelta(minutes=s.mfa_challenge_minutes), ip=ip)
    db.add(ch)
    await db.commit()
    await audit.record(db, "auth.password_ok", user_id=user.id, request=request)
    out = {"challenge_id": ch.id, "mfa_required": True, "method": "totp",
           "expires_at": iso(ch.expires_at), "name": user.profile.full_name if user.profile else ""}
    if s.dev_mode:
        # DEVELOPMENT ONLY: reveal the current authenticator code so demo accounts can sign in
        # without a phone. Disabled automatically when WV_DEV_MODE=false.
        import time as _t

        step = max(int(_t.time() // 30), (user.totp_last_step or 0) + 1)
        out["dev_code"] = totp_for(user).at(step * 30)
    return out


@router.post("/verify")
async def verify(body: VerifyIn, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    ip = request.client.host if request.client else "?"
    if not await allow(f"mfa:ip:{ip}", 30, 300):
        raise HTTPException(429, "Too many attempts")
    ch = await db.get(MfaChallenge, body.challenge_id)
    now = utcnow()
    if ch is None or ch.used or _aware(ch.expires_at) < now or ch.attempts >= 5:
        raise HTTPException(401, "Verification expired. Sign in again.")
    user = await db.get(User, ch.user_id)
    step = check_totp(user, body.code)
    if step is None:
        ch.attempts += 1
        await db.commit()
        await audit.record(db, "auth.mfa_failed", user_id=user.id, severity="warning", request=request)
        raise HTTPException(401, "Invalid verification code")
    ch.used = True
    user.totp_last_step = step
    user.failed_logins = 0
    user.last_login_at = now
    sess, token = await create_session(db, user, request)
    await db.commit()
    await audit.record(db, "auth.login_success", user_id=user.id, request=request, session=sess.id)
    s = get_settings()
    response.set_cookie(
        SESSION_COOKIE, token, httponly=True, secure=s.cookie_secure, samesite="strict",
        max_age=s.session_absolute_hours * 3600, path="/",
    )
    perms = {p.code for p in user.role.permissions}
    return {"user": me_dict(user, perms)}


@router.post("/logout")
async def logout(request: Request, response: Response, p: Principal = Depends(current_principal),
                 db: AsyncSession = Depends(get_db)):
    sess = await db.get(AuthSession, p.session.id)
    sess.revoked_at = utcnow()
    await db.commit()
    await audit.record(db, "auth.logout", user_id=p.id, request=request)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
async def me(p: Principal = Depends(current_principal)):
    return {"user": me_dict(p.user, p.permissions), "session": {
        "id": p.session.id, "created_at": iso(p.session.created_at), "expires_at": iso(p.session.expires_at)}}


@router.get("/sessions")
async def sessions(p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(AuthSession).where(AuthSession.user_id == p.id, AuthSession.revoked_at.is_(None))
        .order_by(AuthSession.last_seen_at.desc())
    )).scalars().all()
    now = utcnow()
    return [{
        "id": r.id, "ip": r.ip, "user_agent": r.user_agent, "created_at": iso(r.created_at),
        "last_seen_at": iso(r.last_seen_at), "expires_at": iso(r.expires_at), "current": r.id == p.session.id,
    } for r in rows if _aware(r.expires_at) > now]


@router.delete("/sessions/{sid}")
async def revoke_session(sid: str, request: Request, p: Principal = Depends(current_principal),
                         db: AsyncSession = Depends(get_db)):
    r = await db.get(AuthSession, sid)
    if r is None or r.user_id != p.id:
        raise HTTPException(404, "Session not found")
    r.revoked_at = utcnow()
    await db.commit()
    await audit.record(db, "auth.session_revoked", user_id=p.id, request=request, session=sid)
    return {"ok": True}


class PasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(max_length=256)


@router.post("/change-password")
async def change_password(body: PasswordIn, request: Request, p: Principal = Depends(current_principal),
                          db: AsyncSession = Depends(get_db)):
    user = await db.get(User, p.id)
    if not verify_password(user.password_hash, body.current_password):
        await audit.record(db, "auth.password_change_failed", user_id=p.id, severity="warning", request=request)
        raise HTTPException(403, "Current password is incorrect")
    validate_password_strength(body.new_password)
    user.password_hash = hash_password(body.new_password)
    # sign out every other session
    for r in (await db.execute(select(AuthSession).where(
            AuthSession.user_id == p.id, AuthSession.id != p.session.id, AuthSession.revoked_at.is_(None)))).scalars():
        r.revoked_at = utcnow()
    await db.commit()
    await audit.record(db, "auth.password_changed", user_id=p.id, request=request)
    return {"ok": True}


class RotateIn(BaseModel):
    password: str
    code: str


@router.post("/mfa/rotate")
async def rotate_mfa(body: RotateIn, request: Request, p: Principal = Depends(current_principal),
                     db: AsyncSession = Depends(get_db)):
    """Re-key the authenticator. Requires password + a current code. Returns the new
    secret once; it is stored only encrypted."""
    user = await db.get(User, p.id)
    step = check_totp(user, body.code)
    if not verify_password(user.password_hash, body.password) or step is None:
        await audit.record(db, "auth.mfa_rotate_failed", user_id=p.id, severity="warning", request=request)
        raise HTTPException(403, "Password or code incorrect")
    secret, enc = new_totp_secret()
    user.totp_secret_enc = enc
    user.totp_last_step = 0
    await db.commit()
    await audit.record(db, "auth.mfa_rotated", user_id=p.id, severity="warning", request=request)
    uri = pyotp.TOTP(secret).provisioning_uri(name=user.email, issuer_name="WORLDVOICE")
    return {"secret": secret, "otpauth_uri": uri}
