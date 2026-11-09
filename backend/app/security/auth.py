"""Passwords, TOTP MFA, server-side sessions and RBAC dependencies."""
from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta

import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Cookie, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db
from ..models import AuthSession, User, utcnow
from .crypto import decrypt, encrypt, random_token, sha256_hex

SESSION_COOKIE = "wv_session"
_ph = PasswordHasher()  # argon2id defaults
_DUMMY_HASH = _ph.hash("timing-equaliser")


def hash_password(pw: str) -> str:
    return _ph.hash(pw)


def verify_password(hash_: str | None, pw: str) -> bool:
    try:
        return _ph.verify(hash_ or _DUMMY_HASH, pw) and hash_ is not None
    except VerifyMismatchError:
        return False
    except Exception:
        return False


def validate_password_strength(pw: str) -> None:
    problems = []
    if len(pw) < 12:
        problems.append("at least 12 characters")
    if not any(c.isupper() for c in pw) or not any(c.islower() for c in pw):
        problems.append("upper and lower case letters")
    if not any(c.isdigit() for c in pw):
        problems.append("a digit")
    if not any(not c.isalnum() for c in pw):
        problems.append("a symbol")
    if problems:
        raise HTTPException(422, "Password must contain " + ", ".join(problems))


# ---------- TOTP ----------
def new_totp_secret() -> tuple[str, str]:
    secret = pyotp.random_base32()
    return secret, encrypt(secret, aad="totp")


def totp_for(user: User) -> pyotp.TOTP:
    return pyotp.TOTP(decrypt(user.totp_secret_enc, aad="totp"))


def check_totp(user: User, code: str) -> int | None:
    """Returns the matched time-step, rejecting codes at or before the last used step
    (prevents replay of an intercepted code inside its validity window)."""
    code = code.strip().replace(" ", "")
    if not code.isdigit() or len(code) != 6:
        return None
    totp = totp_for(user)
    now_step = int(time.time() // 30)
    s = get_settings()
    # DEV ONLY: the login page shows one code and does not refresh it, so accept it for the
    # whole challenge lifetime. Production keeps the strict ±30 s authenticator window.
    back = max(1, s.mfa_challenge_minutes * 2) if s.dev_mode else 1
    for step in range(now_step - back, now_step + 2):
        if pyotp.utils.strings_equal(totp.at(step * 30), code) and step > (user.totp_last_step or 0):
            return step
    return None


# ---------- sessions ----------
def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


async def create_session(db: AsyncSession, user: User, request: Request) -> tuple[AuthSession, str]:
    s = get_settings()
    token = random_token(32)
    sess = AuthSession(
        user_id=user.id,
        token_hash=sha256_hex(token),
        expires_at=utcnow() + timedelta(hours=s.session_absolute_hours),
        ip=request.client.host if request.client else "",
        user_agent=request.headers.get("user-agent", "")[:255],
    )
    db.add(sess)
    await db.flush()
    return sess, token


async def resolve_session(db: AsyncSession, token: str | None) -> tuple[AuthSession, User] | None:
    if not token:
        return None
    sess = (
        await db.execute(select(AuthSession).where(AuthSession.token_hash == sha256_hex(token)))
    ).scalar_one_or_none()
    if sess is None or sess.revoked_at is not None:
        return None
    now = utcnow()
    user = await db.get(User, sess.user_id)
    if user is None or not user.is_active:
        return None
    idle = user.settings.session_idle_minutes if user.settings else get_settings().session_idle_minutes
    if _aware(sess.expires_at) < now or _aware(sess.last_seen_at) + timedelta(minutes=idle) < now:
        sess.revoked_at = now
        await db.commit()
        return None
    if (now - _aware(sess.last_seen_at)).total_seconds() > 30:
        sess.last_seen_at = now
        await db.commit()
    return sess, user


class Principal:
    def __init__(self, user: User, session: AuthSession):
        self.user = user
        self.session = session
        self.permissions = {p.code for p in user.role.permissions}

    @property
    def id(self) -> str:
        return self.user.id

    def can(self, perm: str) -> bool:
        return perm in self.permissions


async def current_principal(
    request: Request,
    db: AsyncSession = Depends(get_db),
    wv_session: str | None = Cookie(default=None),
) -> Principal:
    resolved = await resolve_session(db, wv_session)
    if resolved is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication required")
    sess, user = resolved
    request.state.user_id = user.id
    return Principal(user, sess)


def require(perm: str):
    async def dep(p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)) -> Principal:
        if not p.can(perm):
            from .audit import record

            await record(db, "access.denied", user_id=p.id, severity="warning", permission=perm)
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Missing permission: {perm}")
        return p

    return dep
