from __future__ import annotations

from datetime import UTC, datetime

from .models import Invitation, Meeting, MeetingParticipant, User, UserSettings


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).isoformat()


def user_card(u: User) -> dict:
    p = u.profile
    return {
        "id": u.id,
        "name": p.full_name if p else u.email,
        "title": p.title if p else "",
        "organization": p.organization if p else "",
        "country": {"code": p.country.code, "name": p.country.name} if p and p.country else None,
        "verified": bool(p and p.identity_verified),
        "role": u.role_id,
        "language": u.settings.spoken_language if u.settings else None,
    }


def settings_dict(s: UserSettings) -> dict:
    return {
        "spoken_language": s.spoken_language,
        "listen_language": s.listen_language,
        "ui_language": s.ui_language,
        "auto_detect_language": s.auto_detect_language,
        "subtitles_enabled": s.subtitles_enabled,
        "show_original_subtitles": s.show_original_subtitles,
        "original_audio_volume": s.original_audio_volume,
        "translated_audio_volume": s.translated_audio_volume,
        "use_voice_profile": s.use_voice_profile,
        "noise_suppression": s.noise_suppression,
        "echo_cancellation": s.echo_cancellation,
        "auto_gain": s.auto_gain,
        "video_quality": s.video_quality,
        "speech_engine": s.speech_engine,
        "session_idle_minutes": s.session_idle_minutes,
    }


def me_dict(u: User, permissions: set[str]) -> dict:
    p = u.profile
    return {
        **user_card(u),
        "email": u.email,
        "bio": p.bio if p else "",
        "verified_at": iso(p.verified_at) if p else None,
        "last_login_at": iso(u.last_login_at),
        "permissions": sorted(permissions),
        "settings": settings_dict(u.settings) if u.settings else None,
    }


def participant_dict(mp: MeetingParticipant) -> dict:
    return {
        **user_card(mp.user),
        "meeting_role": mp.role,
        "joined_at": iso(mp.joined_at),
        "left_at": iso(mp.left_at),
    }


def meeting_dict(m: Meeting, *, live_count: int = 0) -> dict:
    return {
        "id": m.id,
        "title": m.title,
        "agenda": m.agenda,
        "status": m.status,
        "security_level": m.security_level,
        "recording_policy": m.recording_policy,
        "scheduled_start": iso(m.scheduled_start),
        "scheduled_end": iso(m.scheduled_end),
        "started_at": iso(m.started_at),
        "ended_at": iso(m.ended_at),
        "created_at": iso(m.created_at),
        "host": user_card(m.host),
        "participants": [participant_dict(p) for p in m.participants],
        "live_participants": live_count,
    }


def invitation_dict(i: Invitation) -> dict:
    return {
        "id": i.id,
        "status": i.status,
        "message": i.message,
        "expires_at": iso(i.expires_at),
        "created_at": iso(i.created_at),
        "responded_at": iso(i.responded_at),
        "meeting": {
            "id": i.meeting.id,
            "title": i.meeting.title,
            "status": i.meeting.status,
            "scheduled_start": iso(i.meeting.scheduled_start),
            "security_level": i.meeting.security_level,
        },
        "inviter": user_card(i.inviter),
        "invitee": user_card(i.invitee),
    }
