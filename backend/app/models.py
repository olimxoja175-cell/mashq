"""Relational schema. Portable between PostgreSQL (production) and SQLite (tests/dev).
Columns ending in `_enc` hold AES-256-GCM ciphertext (see security/crypto.py)."""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_id() -> str:
    return str(uuid.uuid4())


TS = DateTime(timezone=True)

role_permissions = Table(
    "role_permissions",
    Base.metadata,
    Column("role_id", ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    Column("permission_code", ForeignKey("permissions.code", ondelete="CASCADE"), primary_key=True),
)


class Country(Base):
    __tablename__ = "countries"
    code: Mapped[str] = mapped_column(String(2), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    default_language: Mapped[str | None] = mapped_column(ForeignKey("languages.code"))


class Language(Base):
    __tablename__ = "languages"
    code: Mapped[str] = mapped_column(String(8), primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    native_name: Mapped[str] = mapped_column(String(64))
    bcp47: Mapped[str] = mapped_column(String(16))
    rtl: Mapped[bool] = mapped_column(Boolean, default=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class Permission(Base):
    __tablename__ = "permissions"
    code: Mapped[str] = mapped_column(String(64), primary_key=True)
    description: Mapped[str] = mapped_column(String(255))


class Role(Base):
    __tablename__ = "roles"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(String(255), default="")
    permissions: Mapped[list[Permission]] = relationship(secondary=role_permissions, lazy="selectin")


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    totp_secret_enc: Mapped[str] = mapped_column(Text)
    totp_last_step: Mapped[int] = mapped_column(Integer, default=0)  # anti-replay of TOTP codes
    role_id: Mapped[str] = mapped_column(ForeignKey("roles.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(TS)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(TS)

    role: Mapped[Role] = relationship(lazy="selectin")
    profile: Mapped[OfficialProfile] = relationship(back_populates="user", uselist=False, lazy="selectin")
    settings: Mapped[UserSettings] = relationship(uselist=False, lazy="selectin")


class OfficialProfile(Base):
    __tablename__ = "official_profiles"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    full_name: Mapped[str] = mapped_column(String(160))
    title: Mapped[str] = mapped_column(String(160))
    country_code: Mapped[str] = mapped_column(ForeignKey("countries.code"))
    organization: Mapped[str] = mapped_column(String(160), default="")
    bio: Mapped[str] = mapped_column(Text, default="")
    identity_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    verified_at: Mapped[datetime | None] = mapped_column(TS)
    verified_by: Mapped[str | None] = mapped_column(String(36))

    user: Mapped[User] = relationship(back_populates="profile")
    country: Mapped[Country] = relationship(lazy="selectin")


class UserSettings(Base):
    __tablename__ = "user_settings"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    spoken_language: Mapped[str] = mapped_column(ForeignKey("languages.code"))
    listen_language: Mapped[str] = mapped_column(ForeignKey("languages.code"))
    ui_language: Mapped[str] = mapped_column(String(8), default="en")
    auto_detect_language: Mapped[bool] = mapped_column(Boolean, default=True)
    subtitles_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    show_original_subtitles: Mapped[bool] = mapped_column(Boolean, default=True)
    original_audio_volume: Mapped[float] = mapped_column(Float, default=0.15)
    translated_audio_volume: Mapped[float] = mapped_column(Float, default=1.0)
    use_voice_profile: Mapped[bool] = mapped_column(Boolean, default=True)
    noise_suppression: Mapped[bool] = mapped_column(Boolean, default=True)
    echo_cancellation: Mapped[bool] = mapped_column(Boolean, default=True)
    auto_gain: Mapped[bool] = mapped_column(Boolean, default=True)
    video_quality: Mapped[str] = mapped_column(String(16), default="hd")
    speech_engine: Mapped[str] = mapped_column(String(16), default="auto")  # auto | server | browser
    session_idle_minutes: Mapped[int] = mapped_column(Integer, default=30)


class VoiceProfile(Base):
    __tablename__ = "voice_profiles"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="active")  # active | revoked | failed
    provider: Mapped[str] = mapped_column(String(32))
    provider_voice_id_enc: Mapped[str | None] = mapped_column(Text)
    consent_text: Mapped[str] = mapped_column(Text)
    consent_signed_name: Mapped[str] = mapped_column(String(160))
    consent_signed_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    consent_ip: Mapped[str] = mapped_column(String(64), default="")
    sample_sha256: Mapped[str] = mapped_column(String(64))
    sample_seconds: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(TS)


class Contact(Base):
    __tablename__ = "contacts"
    __table_args__ = (UniqueConstraint("owner_id", "contact_user_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    contact_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    note: Mapped[str] = mapped_column(String(255), default="")
    authorized: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)

    contact: Mapped[User] = relationship(foreign_keys=[contact_user_id], lazy="selectin")


class Meeting(Base):
    __tablename__ = "meetings"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    title: Mapped[str] = mapped_column(String(200))
    agenda: Mapped[str] = mapped_column(Text, default="")
    host_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="scheduled")  # scheduled|live|ended|cancelled
    security_level: Mapped[str] = mapped_column(String(16), default="confidential")
    scheduled_start: Mapped[datetime | None] = mapped_column(TS)
    scheduled_end: Mapped[datetime | None] = mapped_column(TS)
    started_at: Mapped[datetime | None] = mapped_column(TS)
    ended_at: Mapped[datetime | None] = mapped_column(TS)
    recording_policy: Mapped[str] = mapped_column(String(24), default="disabled")  # disabled | all_consent
    recording_active: Mapped[bool] = mapped_column(Boolean, default=False)
    store_transcripts: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)

    host: Mapped[User] = relationship(lazy="selectin")
    participants: Mapped[list[MeetingParticipant]] = relationship(
        back_populates="meeting", lazy="selectin", cascade="all, delete-orphan"
    )


class MeetingParticipant(Base):
    __tablename__ = "meeting_participants"
    __table_args__ = (UniqueConstraint("meeting_id", "user_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    meeting_id: Mapped[str] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    role: Mapped[str] = mapped_column(String(16), default="participant")  # host | participant
    spoken_language: Mapped[str | None] = mapped_column(String(8))
    listen_language: Mapped[str | None] = mapped_column(String(8))
    ai_consent: Mapped[bool] = mapped_column(Boolean, default=False)
    recording_consent: Mapped[bool] = mapped_column(Boolean, default=False)
    joined_at: Mapped[datetime | None] = mapped_column(TS)
    left_at: Mapped[datetime | None] = mapped_column(TS)

    meeting: Mapped[Meeting] = relationship(back_populates="participants")
    user: Mapped[User] = relationship(lazy="selectin")


class Invitation(Base):
    __tablename__ = "invitations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    meeting_id: Mapped[str] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"), index=True)
    inviter_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    invitee_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending|accepted|declined|revoked
    message: Mapped[str] = mapped_column(Text, default="")
    expires_at: Mapped[datetime] = mapped_column(TS)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    responded_at: Mapped[datetime | None] = mapped_column(TS)

    meeting: Mapped[Meeting] = relationship(lazy="selectin")
    inviter: Mapped[User] = relationship(foreign_keys=[inviter_id], lazy="selectin")
    invitee: Mapped[User] = relationship(foreign_keys=[invitee_id], lazy="selectin")


class Transcript(Base):
    __tablename__ = "transcripts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    meeting_id: Mapped[str] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"), index=True)
    speaker_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    utterance_id: Mapped[str] = mapped_column(String(64), index=True)
    source_language: Mapped[str] = mapped_column(String(8))
    language_detected: Mapped[bool] = mapped_column(Boolean, default=False)
    text_enc: Mapped[str] = mapped_column(Text)
    stt_provider: Mapped[str] = mapped_column(String(32))
    confidence: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow, index=True)


class TranslationEvent(Base):
    __tablename__ = "translation_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    transcript_id: Mapped[str] = mapped_column(ForeignKey("transcripts.id", ondelete="CASCADE"), index=True)
    meeting_id: Mapped[str] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"), index=True)
    target_language: Mapped[str] = mapped_column(String(8))
    text_enc: Mapped[str] = mapped_column(Text)
    provider: Mapped[str] = mapped_column(String(32))
    tts_provider: Mapped[str] = mapped_column(String(32))
    voice_mode: Mapped[str] = mapped_column(String(16))  # profile | generic | client | none
    uncertain: Mapped[bool] = mapped_column(Boolean, default=False)
    uncertainty_reason: Mapped[str] = mapped_column(Text, default="")
    confidence: Mapped[float | None] = mapped_column(Float)
    stt_ms: Mapped[int] = mapped_column(Integer, default=0)
    mt_ms: Mapped[int] = mapped_column(Integer, default=0)
    tts_ms: Mapped[int] = mapped_column(Integer, default=0)
    total_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow, index=True)


class SecurityEvent(Base):
    """Append-only, hash-chained audit log (each row commits to the previous hash)."""

    __tablename__ = "security_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str | None] = mapped_column(String(36), index=True)
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    severity: Mapped[str] = mapped_column(String(16), default="info")  # info|warning|critical
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(255), default="")
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow, index=True)
    prev_hash: Mapped[str] = mapped_column(String(64), default="")
    hash: Mapped[str] = mapped_column(String(64), default="")


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(TS)
    revoked_at: Mapped[datetime | None] = mapped_column(TS)
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(255), default="")


class MfaChallenge(Base):
    __tablename__ = "mfa_challenges"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    expires_at: Mapped[datetime] = mapped_column(TS)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    ip: Mapped[str] = mapped_column(String(64), default="")


class SystemConfig(Base):
    __tablename__ = "system_config"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)
    updated_by: Mapped[str | None] = mapped_column(String(36))
    updated_at: Mapped[datetime] = mapped_column(TS, default=utcnow, onupdate=utcnow)
