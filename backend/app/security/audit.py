"""Tamper-evident audit log. Each event's hash covers the previous event's hash,
so deleting or editing a row breaks the chain (verify_chain detects it)."""
from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import SecurityEvent, utcnow
from .crypto import sha256_hex

_lock = asyncio.Lock()


def _utc_iso(dt: datetime) -> str:
    if dt.tzinfo is None:  # SQLite drops tzinfo
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).isoformat()


def _digest(prev: str, ev: SecurityEvent) -> str:
    body = json.dumps(
        [prev, ev.user_id, ev.event_type, ev.severity, ev.ip, ev.details, _utc_iso(ev.created_at)],
        sort_keys=True,
        default=str,
    )
    return sha256_hex(body)


def client_ip(request: Request | None) -> str:
    if request is None or request.client is None:
        return ""
    return request.client.host


async def record(
    db: AsyncSession,
    event_type: str,
    *,
    user_id: str | None = None,
    severity: str = "info",
    request: Request | None = None,
    ip: str | None = None,
    **details,
) -> None:
    async with _lock:
        last = (await db.execute(select(SecurityEvent).order_by(SecurityEvent.id.desc()).limit(1))).scalar_one_or_none()
        prev = last.hash if last else ""
        ev = SecurityEvent(
            user_id=user_id,
            event_type=event_type,
            severity=severity,
            ip=ip if ip is not None else client_ip(request),
            user_agent=(request.headers.get("user-agent", "")[:255] if request else ""),
            details=details,
            created_at=utcnow().replace(microsecond=0),
            prev_hash=prev,
        )
        ev.hash = _digest(prev, ev)
        db.add(ev)
        await db.commit()


async def verify_chain(db: AsyncSession) -> tuple[bool, int]:
    rows = (await db.execute(select(SecurityEvent).order_by(SecurityEvent.id))).scalars().all()
    prev = ""
    for ev in rows:
        if ev.prev_hash != prev or _digest(prev, ev) != ev.hash:
            return False, ev.id
        prev = ev.hash
    return True, len(rows)
