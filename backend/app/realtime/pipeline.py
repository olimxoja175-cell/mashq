"""Speech -> text -> translation -> speech pipeline and per-listener routing.

Routing rules (enforced here, covered by tests):
  * Each listener receives the speaker's words in the listener's own target language.
  * Listeners whose target language equals the source language receive no translation
    (they hear the original WebRTC audio directly).
  * The speaker NEVER receives their own translated audio — only their own original
    transcript, so they can confirm what was recognised.
  * Each language is translated once per utterance, then fanned out to every listener
    of that language (no duplicated synthesis, no duplicated playback).
  * Utterances from one speaker are processed strictly in order (per-speaker lock);
    a repeated utterance id is ignored.
  * Synthesis uses only the speaker's own consented voice profile. A voice profile can
    never be applied to anyone else's speech.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import time

from ..ai.languages import LANGUAGES, normalize
from ..ai.providers import AIStack, ProviderError, build_stack, verify_numbers
from ..config import get_settings
from ..db import SessionLocal
from ..models import Transcript, TranslationEvent
from ..security.crypto import encrypt
from .hub import Participant, Room
from .metrics import metrics

log = logging.getLogger("worldvoice.pipeline")

_stack: AIStack | None = None


def get_stack() -> AIStack:
    global _stack
    if _stack is None:
        _stack = build_stack()
    return _stack


def set_stack(stack: AIStack | None) -> None:
    global _stack
    _stack = stack


def _ms(t0: float) -> int:
    return int((time.perf_counter() - t0) * 1000)


async def process_utterance(
    room: Room,
    speaker: Participant,
    *,
    utterance_id: str,
    text: str | None = None,
    audio: bytes | None = None,
    mime: str = "audio/webm",
    language: str | None = None,
    stt_confidence: float | None = None,
    client_ts: float | None = None,
) -> None:
    if not speaker.ai_consent:
        await room.send(speaker.user_id, {"type": "error", "code": "ai_consent_required",
                                          "message": "AI translation consent is required before speech is processed."})
        return
    if not room.mark_seen(f"{speaker.user_id}:{utterance_id}"):
        metrics.inc("utterance.duplicate_ignored")
        return

    stack = get_stack()
    s = get_settings()
    async with room.lock_for(speaker.user_id):
        t_start = time.perf_counter()
        stt_ms = 0
        detected = False
        stt_provider = "browser"

        # ---- 1. speech recognition / language identification ----
        if audio is not None:
            t0 = time.perf_counter()
            hint = None if speaker.auto_detect else speaker.spoken
            try:
                res = await stack.stt.transcribe(audio, mime, hint)
            except ProviderError as e:
                metrics.error("stt", str(e))
                await room.send(speaker.user_id, {"type": "error", "code": "stt_failed", "message": str(e)})
                return
            stt_ms = _ms(t0)
            text, stt_confidence, stt_provider = res.text, res.confidence, res.provider
            source = res.language if (speaker.auto_detect and res.language in LANGUAGES) else speaker.spoken
            detected = speaker.auto_detect and res.language is not None
        else:
            source = normalize(language) if speaker.auto_detect else speaker.spoken
            source = source if source in LANGUAGES else speaker.spoken

        text = (text or "").strip()
        if not text:
            return
        if len(text) > 2000:
            text = text[:2000]

        # ---- 2. original transcript to everyone (speaker sees what was recognised) ----
        stt_uncertain = stt_confidence is not None and stt_confidence < s.uncertainty_threshold
        await room.broadcast({
            "type": "transcript",
            "utterance_id": utterance_id,
            "speaker_id": speaker.user_id,
            "language": source,
            "language_detected": detected,
            "text": text,
            "confidence": stt_confidence,
            "uncertain": stt_uncertain,
        })

        # ---- 3. group listeners by target language (never the speaker) ----
        groups: dict[str, list[str]] = {}
        for uid, p in list(room.participants.items()):
            if uid == speaker.user_id or p.listen == source:
                continue
            groups.setdefault(p.listen, []).append(uid)

        context = list(room.context)
        room.context.append((source, text))

        async def one_language(target: str, listeners: list[str]) -> dict:
            t0 = time.perf_counter()
            try:
                tr = await stack.translator.translate(text, source, target, context, room.glossary)
            except ProviderError as e:
                metrics.error("translation", str(e))
                msg = {"type": "translation.failed", "utterance_id": utterance_id, "speaker_id": speaker.user_id,
                       "source_language": source, "target_language": target, "original_text": text,
                       "message": "Translation unavailable — showing original text."}
                await asyncio.gather(*(room.send(u, msg) for u in listeners))
                return {}
            mt_ms = _ms(t0)

            reasons = list(tr.reasons)
            if stt_uncertain:
                reasons.insert(0, f"Speech recognition confidence is low ({stt_confidence:.2f}); words may have been misheard.")
            num_issue = verify_numbers(text, tr.text) if not tr.simulated or tr.confidence > 0 else None
            if num_issue:
                reasons.append(num_issue)
            uncertain = tr.uncertain or stt_uncertain or bool(num_issue)

            # ---- 4. speech synthesis in the speaker's own voice (if consented) ----
            t1 = time.perf_counter()
            audio_b64, mime_out, tts_provider, voice_mode = None, "", "none", "none"
            speakable = not (tr.simulated and tr.confidence == 0)  # never voice an untranslated fallback
            if speakable:
                try:
                    tts = await stack.tts.synthesize(tr.text, target, speaker.voice_id)
                    tts_provider, voice_mode = tts.provider, tts.voice_mode
                    if tts.audio:
                        audio_b64, mime_out = base64.b64encode(tts.audio).decode(), tts.mime
                except ProviderError as e:
                    metrics.error("tts", str(e))
                    tts_provider, voice_mode = "browser-speech", "client"
            tts_ms = _ms(t1)
            total = _ms(t_start)

            msg = {
                "type": "translation",
                "utterance_id": utterance_id,
                "speaker_id": speaker.user_id,
                "source_language": source,
                "target_language": target,
                "text": tr.text,
                "original_text": text,
                "confidence": tr.confidence,
                "uncertain": uncertain,
                "uncertainty_reasons": reasons,
                "provider": tr.provider,
                "simulated": tr.simulated,
                "speak": speakable,
                "audio": audio_b64,
                "audio_mime": mime_out,
                "voice_mode": voice_mode,  # profile | generic | client | none
                "synthetic_voice": True,
                "latency": {"stt_ms": stt_ms, "mt_ms": mt_ms, "tts_ms": tts_ms, "total_ms": total},
                "client_ts": client_ts,
            }
            await asyncio.gather(*(room.send(u, msg) for u in listeners))
            metrics.record(stt_ms=stt_ms or None, mt_ms=mt_ms, tts_ms=tts_ms if audio_b64 else None,
                           total_ms=total, uncertain=uncertain, target=target, source=source)
            metrics.inc("translation.delivered", len(listeners))
            return {"target": target, "text": tr.text, "provider": tr.provider, "tts": tts_provider,
                    "voice_mode": voice_mode, "uncertain": uncertain, "reasons": reasons,
                    "confidence": tr.confidence, "stt_ms": stt_ms, "mt_ms": mt_ms, "tts_ms": tts_ms, "total_ms": total}

        results = await asyncio.gather(*(one_language(t, ls) for t, ls in groups.items()))
        metrics.inc("utterance.processed")

        # ---- 5. persist only when the meeting record is active (consented) ----
        if room.recording_active:
            try:
                await _persist(room, speaker, utterance_id, source, detected, text, stt_provider,
                               stt_confidence, [r for r in results if r])
            except Exception as e:  # never break the live meeting because of storage
                log.exception("persist failed")
                metrics.error("storage", str(e))


async def _persist(room, speaker, utterance_id, source, detected, text, stt_provider, conf, results) -> None:
    async with SessionLocal() as db:
        tr = Transcript(
            meeting_id=room.meeting_id, speaker_id=speaker.user_id, utterance_id=utterance_id,
            source_language=source, language_detected=detected,
            text_enc=encrypt(text, aad=room.meeting_id), stt_provider=stt_provider, confidence=conf,
        )
        db.add(tr)
        await db.flush()
        for r in results:
            db.add(TranslationEvent(
                transcript_id=tr.id, meeting_id=room.meeting_id, target_language=r["target"],
                text_enc=encrypt(r["text"], aad=room.meeting_id), provider=r["provider"],
                tts_provider=r["tts"], voice_mode=r["voice_mode"], uncertain=r["uncertain"],
                uncertainty_reason=" | ".join(r["reasons"]), confidence=r["confidence"],
                stt_ms=r["stt_ms"], mt_ms=r["mt_ms"], tts_ms=r["tts_ms"], total_ms=r["total_ms"],
            ))
        await db.commit()
