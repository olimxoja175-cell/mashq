from __future__ import annotations

import hashlib
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ai.languages import LANGUAGES
from ..db import get_db
from ..models import Contact, Country, OfficialProfile, User, UserSettings, VoiceProfile, utcnow
from ..realtime.pipeline import get_stack
from ..security import audit
from ..security.auth import Principal, current_principal, require
from ..security.crypto import encrypt, decrypt
from ..serializers import iso, me_dict, settings_dict, user_card

router = APIRouter(prefix="/api", tags=["profile"])


@router.get("/languages")
async def languages():
    return [{"code": l.code, "name": l.name, "native": l.native, "bcp47": l.bcp47, "rtl": l.rtl}
            for l in LANGUAGES.values()]


@router.get("/countries")
async def countries(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Country).order_by(Country.name))).scalars().all()
    return [{"code": c.code, "name": c.name, "default_language": c.default_language} for c in rows]


@router.get("/ai/status")
async def ai_status(p: Principal = Depends(current_principal)):
    return get_stack().status()


# ---------------- profile ----------------
class ProfileIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=160)
    title: str = Field(min_length=2, max_length=160)
    organization: str = Field(default="", max_length=160)
    bio: str = Field(default="", max_length=2000)


@router.get("/profile")
async def get_profile(p: Principal = Depends(current_principal)):
    return me_dict(p.user, p.permissions)


@router.put("/profile")
async def update_profile(body: ProfileIn, request: Request, p: Principal = Depends(current_principal),
                         db: AsyncSession = Depends(get_db)):
    prof = await db.get(OfficialProfile, p.id)
    name_changed = prof.full_name != body.full_name or prof.title != body.title
    prof.full_name, prof.title, prof.organization, prof.bio = body.full_name, body.title, body.organization, body.bio
    if name_changed and prof.identity_verified:
        # Changing an official name or title invalidates the identity verification badge
        prof.identity_verified = False
        prof.verified_at = None
    await db.commit()
    await audit.record(db, "profile.updated", user_id=p.id, request=request, reverification=name_changed)
    user = await db.get(User, p.id)
    await db.refresh(user, ["profile"])
    return me_dict(user, p.permissions)


# ---------------- settings ----------------
class SettingsIn(BaseModel):
    spoken_language: str | None = None
    listen_language: str | None = None
    ui_language: str | None = None
    auto_detect_language: bool | None = None
    subtitles_enabled: bool | None = None
    show_original_subtitles: bool | None = None
    original_audio_volume: float | None = Field(default=None, ge=0, le=1)
    translated_audio_volume: float | None = Field(default=None, ge=0, le=1)
    use_voice_profile: bool | None = None
    noise_suppression: bool | None = None
    echo_cancellation: bool | None = None
    auto_gain: bool | None = None
    video_quality: Literal["sd", "hd", "fhd"] | None = None
    speech_engine: Literal["auto", "server", "browser"] | None = None
    session_idle_minutes: int | None = Field(default=None, ge=5, le=120)


@router.get("/settings")
async def get_user_settings(p: Principal = Depends(current_principal)):
    return settings_dict(p.user.settings)


@router.put("/settings")
async def update_settings(body: SettingsIn, request: Request, p: Principal = Depends(current_principal),
                          db: AsyncSession = Depends(get_db)):
    st = await db.get(UserSettings, p.id)
    data = body.model_dump(exclude_none=True)
    for key in ("spoken_language", "listen_language", "ui_language"):
        if key in data and data[key] not in LANGUAGES:
            raise HTTPException(422, f"Unsupported language: {data[key]}")
    for k, v in data.items():
        setattr(st, k, v)
    await db.commit()
    await audit.record(db, "settings.updated", user_id=p.id, request=request, fields=sorted(data))
    return settings_dict(st)


# ---------------- voice identity ----------------
CONSENT_TEXT = (
    "I, the undersigned, consent to WORLDVOICE creating a synthetic voice profile from the recordings I provide, "
    "for the sole purpose of speaking MY OWN words, translated, to participants of meetings I attend. "
    "It must never be used to generate speech I did not say. I can revoke this consent at any time, "
    "after which the profile is deleted from the voice provider."
)


def _voice_dict(v: VoiceProfile | None) -> dict:
    if v is None:
        return {"status": "none", "consent_text": CONSENT_TEXT}
    return {
        "status": v.status, "provider": v.provider, "consent_signed_name": v.consent_signed_name,
        "consent_signed_at": iso(v.consent_signed_at), "sample_seconds": v.sample_seconds,
        "sample_sha256": v.sample_sha256, "created_at": iso(v.created_at), "revoked_at": iso(v.revoked_at),
        "consent_text": CONSENT_TEXT,
    }


async def _active_voice(db: AsyncSession, user_id: str) -> VoiceProfile | None:
    return (await db.execute(
        select(VoiceProfile).where(VoiceProfile.user_id == user_id, VoiceProfile.status == "active")
        .order_by(VoiceProfile.created_at.desc()).limit(1)
    )).scalar_one_or_none()


@router.get("/voice/profile")
async def voice_profile(p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    out = _voice_dict(await _active_voice(db, p.id))
    stack = get_stack()
    out["provider_available"] = stack.tts.clones_voice
    out["provider"] = out.get("provider") or stack.tts.name
    return out


@router.post("/voice/enroll")
async def enroll_voice(
    request: Request,
    consent: bool = Form(...),
    signed_name: str = Form(..., min_length=2, max_length=160),
    sample_seconds: float = Form(0),
    samples: list[UploadFile] = File(...),
    p: Principal = Depends(require("voice.enroll")),
    db: AsyncSession = Depends(get_db),
):
    if not consent:
        raise HTTPException(422, "Explicit consent is required")
    # Anti-impersonation: the signature must match the verified official's own name.
    if signed_name.strip().casefold() != p.user.profile.full_name.strip().casefold():
        await audit.record(db, "voice.enroll_name_mismatch", user_id=p.id, severity="critical", request=request)
        raise HTTPException(403, "The consent signature must match your verified official name")
    if not p.user.profile.identity_verified:
        raise HTTPException(403, "Identity must be verified by an administrator before voice enrollment")
    if await _active_voice(db, p.id):
        raise HTTPException(409, "Revoke the existing voice profile first")
    if not samples or len(samples) > 5:
        raise HTTPException(422, "Provide 1–5 voice samples")
    blobs = []
    digest = hashlib.sha256()
    for f in samples:
        data = await f.read()
        if len(data) > 10 * 1024 * 1024:
            raise HTTPException(413, "Sample too large (max 10 MB)")
        if not (f.content_type or "").startswith("audio/"):
            raise HTTPException(415, "Samples must be audio")
        digest.update(data)
        blobs.append((f.filename or "sample.webm", data, f.content_type))
    if sample_seconds < 30:
        raise HTTPException(422, "At least 30 seconds of speech are required")

    stack = get_stack()
    if not stack.tts.clones_voice:
        raise HTTPException(503, "No voice-cloning provider is configured (set ELEVENLABS_API_KEY). "
                                 "Translated speech currently uses a generic voice.")
    from ..ai.providers import ProviderError

    try:
        voice_id = await stack.tts.enroll_voice(f"WV-{p.id[:8]}", blobs)
    except ProviderError as e:
        raise HTTPException(502, str(e)) from e
    # Raw samples are not retained by WORLDVOICE — only their hash, for audit.
    v = VoiceProfile(
        user_id=p.id, provider=stack.tts.name, provider_voice_id_enc=encrypt(voice_id, aad=f"voice:{p.id}"),
        consent_text=CONSENT_TEXT, consent_signed_name=signed_name, consent_ip=request.client.host if request.client else "",
        sample_sha256=digest.hexdigest(), sample_seconds=sample_seconds,
    )
    db.add(v)
    await db.commit()
    await audit.record(db, "voice.enrolled", user_id=p.id, severity="warning", request=request,
                       provider=stack.tts.name, sample_sha256=v.sample_sha256)
    return _voice_dict(v)


@router.delete("/voice/profile")
async def revoke_voice(request: Request, p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    v = await _active_voice(db, p.id)
    if v is None:
        raise HTTPException(404, "No active voice profile")
    try:
        if v.provider_voice_id_enc:
            await get_stack().tts.delete_voice(decrypt(v.provider_voice_id_enc, aad=f"voice:{p.id}"))
    except Exception:
        pass
    v.status, v.revoked_at, v.provider_voice_id_enc = "revoked", utcnow(), None
    await db.commit()
    await audit.record(db, "voice.revoked", user_id=p.id, severity="warning", request=request)
    return _voice_dict(None)


async def voice_id_for(db: AsyncSession, user_id: str) -> str | None:
    v = await _active_voice(db, user_id)
    if v and v.provider_voice_id_enc:
        return decrypt(v.provider_voice_id_enc, aad=f"voice:{user_id}")
    return None


# ---------------- contacts ----------------
@router.get("/contacts")
async def list_contacts(p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Contact).where(Contact.owner_id == p.id).order_by(Contact.created_at))).scalars().all()
    return [{"id": c.id, "note": c.note, "authorized": c.authorized, "created_at": iso(c.created_at),
             "user": user_card(c.contact)} for c in rows]


@router.get("/directory")
async def directory(q: str = "", p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    """Search verified officials (only verified identities can be added as contacts)."""
    stmt = select(User).join(OfficialProfile).where(User.is_active.is_(True), User.id != p.id,
                                                    OfficialProfile.identity_verified.is_(True))
    if q:
        like = f"%{q.strip()[:60]}%"
        stmt = stmt.where(or_(OfficialProfile.full_name.ilike(like), OfficialProfile.title.ilike(like),
                              OfficialProfile.country_code.ilike(like)))
    rows = (await db.execute(stmt.limit(50))).scalars().all()
    return [user_card(u) for u in rows]


class ContactIn(BaseModel):
    user_id: str
    note: str = Field(default="", max_length=255)


@router.post("/contacts")
async def add_contact(body: ContactIn, request: Request, p: Principal = Depends(require("contacts.manage")),
                      db: AsyncSession = Depends(get_db)):
    target = await db.get(User, body.user_id)
    if target is None or target.id == p.id or not target.is_active or not target.profile.identity_verified:
        raise HTTPException(404, "Verified official not found")
    exists = (await db.execute(select(Contact).where(Contact.owner_id == p.id, Contact.contact_user_id == target.id))).scalar_one_or_none()
    if exists:
        raise HTTPException(409, "Already in contacts")
    c = Contact(owner_id=p.id, contact_user_id=target.id, note=body.note)
    db.add(c)
    await db.commit()
    await audit.record(db, "contact.added", user_id=p.id, request=request, contact=target.id)
    c = await db.get(Contact, c.id)
    return {"id": c.id, "note": c.note, "authorized": c.authorized, "created_at": iso(c.created_at),
            "user": user_card(target)}


class ContactPatch(BaseModel):
    authorized: bool | None = None
    note: str | None = Field(default=None, max_length=255)


@router.patch("/contacts/{cid}")
async def patch_contact(cid: str, body: ContactPatch, request: Request, p: Principal = Depends(current_principal),
                        db: AsyncSession = Depends(get_db)):
    c = await db.get(Contact, cid)
    if c is None or c.owner_id != p.id:
        raise HTTPException(404, "Contact not found")
    if body.authorized is not None:
        c.authorized = body.authorized
    if body.note is not None:
        c.note = body.note
    await db.commit()
    await audit.record(db, "contact.updated", user_id=p.id, request=request, contact=c.contact_user_id,
                       authorized=c.authorized)
    return {"ok": True, "authorized": c.authorized, "note": c.note}


@router.delete("/contacts/{cid}")
async def delete_contact(cid: str, request: Request, p: Principal = Depends(current_principal),
                         db: AsyncSession = Depends(get_db)):
    c = await db.get(Contact, cid)
    if c is None or c.owner_id != p.id:
        raise HTTPException(404, "Contact not found")
    await db.delete(c)
    await db.commit()
    await audit.record(db, "contact.removed", user_id=p.id, request=request)
    return {"ok": True}
