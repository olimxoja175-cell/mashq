"""Central configuration. Every value can be overridden with an environment variable
(prefix WV_) or a .env file. Nothing secret is hard-coded for production: when
WV_DEV_MODE is false the app refuses to start without real secrets."""
from __future__ import annotations

import base64
import hashlib
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="WV_", env_file=".env", extra="ignore")

    # --- general ---
    dev_mode: bool = True
    app_name: str = "WORLDVOICE"
    database_url: str = "sqlite+aiosqlite:///./worldvoice.db"
    redis_url: str | None = None
    allowed_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000", "http://127.0.0.1:3000"])
    cookie_secure: bool = False

    # --- secrets ---
    secret_key: str = ""  # HMAC key for tickets / invitation tokens
    data_key: str = ""  # base64 32-byte AES-256-GCM key for encryption at rest
    data_key_id: str = "v1"

    # --- sessions ---
    session_absolute_hours: int = 12
    session_idle_minutes: int = 30
    mfa_challenge_minutes: int = 5
    max_failed_logins: int = 5
    lockout_minutes: int = 15
    login_ip_limit: int = 20  # attempts per IP per 5 minutes
    ws_ticket_seconds: int = 30
    invitation_days: int = 7

    # --- WebRTC ---
    stun_urls: list[str] = Field(default_factory=list)
    turn_urls: list[str] = Field(default_factory=list)
    turn_secret: str = ""  # coturn use-auth-secret / static-auth-secret
    turn_ttl_seconds: int = 3600
    max_mesh_participants: int = 6

    # --- AI providers ---
    stt_provider: str = "auto"  # auto | openai | gemini | browser
    translation_provider: str = "auto"  # auto | anthropic | gemini | dev
    tts_provider: str = "auto"  # auto | elevenlabs | openai | gemini | client

    # Google Gemini (one key covers speech recognition, translation and speech synthesis)
    gemini_api_key: str | None = Field(default=None, validation_alias="GEMINI_API_KEY")
    gemini_model: str = "gemini-3.1-flash-lite"  # translation; fast and accurate in tests
    gemini_fallback_model: str = "gemini-3.5-flash"  # used once when the main model is overloaded
    gemini_stt_model: str = "gemini-3.1-flash-lite"
    gemini_tts_model: str = "gemini-3.8-flash-lite-tts"
    gemini_tts_voice: str = "Charon"

    anthropic_api_key: str | None = Field(default=None, validation_alias="ANTHROPIC_API_KEY")
    anthropic_model: str = "claude-opus-5-5"
    anthropic_effort: str = "low"  # latency-sensitive route; raise for higher-stakes meetings

    openai_api_key: str | None = Field(default=None, validation_alias="OPENAI_API_KEY")
    openai_stt_model: str = "whisper-1"
    openai_tts_model: str = "gpt-4o-mini-tts"
    openai_tts_voice: str = "alloy"

    elevenlabs_api_key: str | None = Field(default=None, validation_alias="ELEVENLABS_API_KEY")
    elevenlabs_model: str = "eleven_multilingual_v2"
    # Languages the configured ElevenLabs model is documented to speak. Verify against
    # the provider docs for the chosen model and adjust; languages outside this list
    # fall back to the generic TTS provider (or browser speech) and are labelled as such.
    elevenlabs_languages: list[str] = Field(
        default_factory=lambda: ["zh", "en", "ru", "ar", "fr", "de", "es", "tr", "hi", "ja", "ko", "pt"]
    )

    translation_context_utterances: int = 6
    uncertainty_threshold: float = 0.75

    def resolved_secret_key(self) -> bytes:
        if self.secret_key:
            return self.secret_key.encode()
        if not self.dev_mode:
            raise RuntimeError("WV_SECRET_KEY must be set when WV_DEV_MODE=false")
        return b"worldvoice-dev-only-secret-do-not-use-in-production"

    def resolved_data_key(self) -> bytes:
        if self.data_key:
            key = base64.b64decode(self.data_key)
            if len(key) != 32:
                raise RuntimeError("WV_DATA_KEY must be base64 of exactly 32 bytes")
            return key
        if not self.dev_mode:
            raise RuntimeError("WV_DATA_KEY must be set when WV_DEV_MODE=false")
        return hashlib.sha256(b"worldvoice-dev-only-data-key").digest()


@lru_cache
def get_settings() -> Settings:
    return Settings()
