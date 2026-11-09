"""AI provider abstraction layer.

Three independent interfaces — SpeechToText, Translator, TextToSpeech — each with
real implementations (OpenAI Whisper, Anthropic Claude, ElevenLabs, OpenAI TTS) and
explicitly-labelled development fallbacks. Providers are chosen at startup from
configuration; swapping a vendor means adding one class and one registry branch.

Capabilities used here are limited to documented public endpoints:
  * OpenAI  POST /v1/audio/transcriptions (whisper-1, verbose_json -> language)
  * OpenAI  POST /v1/audio/speech         (generic voices, no cloning)
  * ElevenLabs POST /v1/voices/add        (instant voice clone from consented samples)
  * ElevenLabs POST /v1/text-to-speech/{voice_id}
  * Anthropic Messages API (anthropic Python SDK)
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field

import httpx

from ..config import Settings, get_settings
from . import dev_glossary
from .languages import LANGUAGES, normalize

log = logging.getLogger("worldvoice.ai")


class ProviderError(RuntimeError):
    pass


# ======================= results =======================
@dataclass
class STTResult:
    text: str
    language: str | None
    confidence: float | None
    provider: str


@dataclass
class TranslationResult:
    text: str
    confidence: float
    uncertain: bool
    reasons: list[str] = field(default_factory=list)
    provider: str = ""
    simulated: bool = False


@dataclass
class TTSResult:
    audio: bytes | None  # None => client must synthesise locally (browser speech)
    mime: str
    provider: str
    voice_mode: str  # profile | generic | client


# ======================= speech to text =======================
class SpeechToText:
    name = "none"
    available = False

    async def transcribe(self, audio: bytes, mime: str, language_hint: str | None) -> STTResult:
        raise ProviderError("Server speech recognition is not configured. Use browser speech recognition.")


class OpenAIWhisperSTT(SpeechToText):
    name = "openai-whisper"
    available = True

    def __init__(self, s: Settings):
        self.s = s
        self.client = httpx.AsyncClient(base_url="https://api.openai.com/v1", timeout=30)

    async def transcribe(self, audio: bytes, mime: str, language_hint: str | None) -> STTResult:
        ext = "webm" if "webm" in mime else "ogg" if "ogg" in mime else "wav" if "wav" in mime else "mp4"
        data = {"model": self.s.openai_stt_model, "response_format": "verbose_json"}
        if language_hint:
            data["language"] = language_hint
        r = await self.client.post(
            "/audio/transcriptions",
            headers={"Authorization": f"Bearer {self.s.openai_api_key}"},
            data=data,
            files={"file": (f"utterance.{ext}", audio, mime)},
        )
        if r.status_code >= 400:
            raise ProviderError(f"OpenAI STT error {r.status_code}: {r.text[:200]}")
        body = r.json()
        segs = body.get("segments") or []
        conf = None
        if segs:
            import math

            avg = sum(s.get("avg_logprob", 0) for s in segs) / len(segs)
            conf = round(max(0.0, min(1.0, math.exp(avg))), 3)
            if any(s.get("no_speech_prob", 0) > 0.6 for s in segs):
                conf = min(conf, 0.4)
        return STTResult(
            text=(body.get("text") or "").strip(),
            language=normalize(body.get("language")) or language_hint,
            confidence=conf,
            provider=self.name,
        )


# ======================= translation =======================
_SYSTEM_PROMPT = """You are the simultaneous interpreter for an official meeting between heads of state and their authorized representatives. You translate one utterance at a time.

Rules:
- Translate the speaker's meaning completely and faithfully, in the formal diplomatic register of the target language.
- Never summarize, shorten, soften, embellish, or add content. Preserve hedges, commitments, conditions, and tone exactly.
- Keep every number, date, amount, percentage and unit exactly; render dates in the target language's conventional format without changing their value.
- Render country names, organizations, treaties and personal names by their established official names in the target language. Titles and forms of address use the target language's protocol conventions.
- Use the preceding utterances only as context to resolve pronouns, terminology and ellipsis. Translate only the current utterance.
- If the source is garbled, ambiguous, incomplete, or a word may have been misheard, still give the most faithful translation, but set "uncertain" to true and explain in "uncertainty_notes" (in English) exactly which part is unclear. Never silently guess.
- Report a calibrated "confidence" between 0 and 1.

Return only the JSON object described by the schema."""

_SCHEMA = {
    "type": "object",
    "properties": {
        "translation": {"type": "string"},
        "confidence": {"type": "number"},
        "uncertain": {"type": "boolean"},
        "uncertainty_notes": {"type": "string"},
    },
    "required": ["translation", "confidence", "uncertain", "uncertainty_notes"],
    "additionalProperties": False,
}


class Translator:
    name = "none"
    simulated = False

    async def translate(
        self, text: str, source: str, target: str, context: list[tuple[str, str]], glossary: list[str]
    ) -> TranslationResult:
        raise NotImplementedError


class DevGlossaryTranslator(Translator):
    name = "dev-glossary"
    simulated = True

    async def translate(self, text, source, target, context, glossary) -> TranslationResult:
        hit = dev_glossary.lookup(text, source, target)
        if hit is None:
            return TranslationResult(
                text=text,
                confidence=0.0,
                uncertain=True,
                reasons=[
                    "DEVELOPMENT MODE: no translation provider is connected and this sentence is not in the "
                    "demo phrase table. The original-language text is shown untranslated."
                ],
                provider=self.name,
                simulated=True,
            )
        out, score = hit
        reasons = [] if score >= 0.97 else [f"Approximate phrase-table match (score {score}). Verify against the original."]
        return TranslationResult(out, score, bool(reasons), reasons, self.name, True)


class AnthropicTranslator(Translator):
    name = "anthropic"

    def __init__(self, s: Settings):
        import anthropic

        self.s = s
        self.anthropic = anthropic
        self.client = anthropic.AsyncAnthropic(api_key=s.anthropic_api_key, timeout=20, max_retries=1)

    async def translate(self, text, source, target, context, glossary) -> TranslationResult:
        src, tgt = LANGUAGES[source], LANGUAGES[target]
        ctx = "\n".join(f"[{lang}] {t}" for lang, t in context[-self.s.translation_context_utterances :]) or "(none)"
        terms = "\n".join(glossary) or "(none)"
        user = (
            f"Source language: {src.name} ({src.code})\nTarget language: {tgt.name} ({tgt.code})\n\n"
            f"Meeting terminology and participant names:\n{terms}\n\n"
            f"Preceding utterances (context only):\n{ctx}\n\n"
            f"Utterance to translate:\n<utterance>{text}</utterance>"
        )
        try:
            resp = await self.client.beta.messages.create(
                model=self.s.anthropic_model,
                max_tokens=4000,
                system=_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user}],
                output_config={"effort": self.s.anthropic_effort, "format": {"type": "json_schema", "schema": _SCHEMA}},
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except self.anthropic.RateLimitError as e:
            raise ProviderError("Translation provider rate limited") from e
        except self.anthropic.APIStatusError as e:
            raise ProviderError(f"Translation provider error {e.status_code}") from e
        except self.anthropic.APIConnectionError as e:
            raise ProviderError("Translation provider unreachable") from e

        if resp.stop_reason == "refusal":
            raise ProviderError("Translation provider declined this utterance")
        raw = "".join(getattr(b, "text", "") for b in resp.content if getattr(b, "type", "") == "text")
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            raise ProviderError("Translation provider returned malformed output") from e
        reasons = [data["uncertainty_notes"]] if data.get("uncertain") and data.get("uncertainty_notes") else []
        conf = float(data.get("confidence", 0))
        return TranslationResult(
            text=data["translation"].strip(),
            confidence=conf,
            uncertain=bool(data.get("uncertain")) or conf < self.s.uncertainty_threshold,
            reasons=reasons or (["Low translation confidence"] if conf < self.s.uncertainty_threshold else []),
            provider=f"anthropic:{self.s.anthropic_model}",
        )


# ======================= text to speech =======================
class TextToSpeech:
    name = "client"
    clones_voice = False

    async def synthesize(self, text: str, language: str, voice_id: str | None) -> TTSResult:
        return TTSResult(None, "", "browser-speech", "client")

    async def enroll_voice(self, name: str, samples: list[tuple[str, bytes, str]]) -> str:
        raise ProviderError("Voice cloning provider is not configured")

    async def delete_voice(self, voice_id: str) -> None:
        return None


class OpenAITTS(TextToSpeech):
    name = "openai-tts"

    def __init__(self, s: Settings):
        self.s = s
        self.client = httpx.AsyncClient(base_url="https://api.openai.com/v1", timeout=30)

    async def synthesize(self, text, language, voice_id) -> TTSResult:
        r = await self.client.post(
            "/audio/speech",
            headers={"Authorization": f"Bearer {self.s.openai_api_key}"},
            json={"model": self.s.openai_tts_model, "voice": self.s.openai_tts_voice, "input": text, "response_format": "mp3"},
        )
        if r.status_code >= 400:
            raise ProviderError(f"OpenAI TTS error {r.status_code}")
        return TTSResult(r.content, "audio/mpeg", self.name, "generic")


class ElevenLabsTTS(TextToSpeech):
    name = "elevenlabs"
    clones_voice = True

    def __init__(self, s: Settings, generic: TextToSpeech):
        self.s = s
        self.generic = generic
        self.client = httpx.AsyncClient(
            base_url="https://api.elevenlabs.io/v1", timeout=30, headers={"xi-api-key": s.elevenlabs_api_key or ""}
        )

    async def synthesize(self, text, language, voice_id) -> TTSResult:
        if not voice_id or language not in self.s.elevenlabs_languages:
            # No consented voice profile, or the configured model does not cover this
            # language: use generic speech and say so in the UI.
            return await self.generic.synthesize(text, language, None)
        r = await self.client.post(
            f"/text-to-speech/{voice_id}",
            params={"output_format": "mp3_44100_128"},
            json={
                "text": text,
                "model_id": self.s.elevenlabs_model,
                "voice_settings": {"stability": 0.5, "similarity_boost": 0.85, "style": 0.2, "use_speaker_boost": True},
            },
        )
        if r.status_code >= 400:
            raise ProviderError(f"ElevenLabs TTS error {r.status_code}")
        return TTSResult(r.content, "audio/mpeg", self.name, "profile")

    async def enroll_voice(self, name, samples) -> str:
        files = [("files", (fname, data, mime)) for fname, data, mime in samples]
        r = await self.client.post(
            "/voices/add",
            data={"name": name, "description": "WORLDVOICE consented voice profile"},
            files=files,
        )
        if r.status_code >= 400:
            raise ProviderError(f"ElevenLabs voice enrollment failed ({r.status_code})")
        return r.json()["voice_id"]

    async def delete_voice(self, voice_id) -> None:
        await self.client.delete(f"/voices/{voice_id}")


# ======================= Google Gemini (STT + translation + TTS) =======================
class _Gemini:
    """Minimal client for the Gemini generateContent REST endpoint."""

    BASE = "https://generativelanguage.googleapis.com/v1beta/models/"

    def __init__(self, s: Settings):
        self.s = s
        self.client = httpx.AsyncClient(timeout=30, headers={"x-goog-api-key": s.gemini_api_key or ""})

    async def generate(self, model: str, body: dict, what: str) -> dict:
        models = [model] + ([self.s.gemini_fallback_model] if self.s.gemini_fallback_model not in ("", model) else [])
        last = ""
        for m in models:
            try:
                r = await self.client.post(f"{self.BASE}{m}:generateContent", json=body)
            except httpx.HTTPError as e:
                raise ProviderError(f"Gemini {what} unreachable") from e
            if r.status_code == 200:
                return r.json()
            last = f"Gemini {what} error {r.status_code}: {r.text[:200]}"
            if r.status_code not in (429, 500, 503):  # only overload/quota is worth one retry
                break
            log.warning("%s (model %s); retrying with fallback", last, m)
        raise ProviderError(last)

    @staticmethod
    def parts(resp: dict) -> list[dict]:
        try:
            return resp["candidates"][0]["content"]["parts"]
        except (KeyError, IndexError) as e:
            reason = (resp.get("promptFeedback") or {}).get("blockReason") or "empty response"
            raise ProviderError(f"Gemini returned no content ({reason})") from e

    @classmethod
    def text(cls, resp: dict) -> str:
        return "".join(p.get("text", "") for p in cls.parts(resp) if not p.get("thought"))

    @staticmethod
    def fast(model: str) -> dict:
        # Interpretation is latency-bound: keep model "thinking" to the minimum.
        return {"thinkingBudget": 0} if "2.5" in model else {"thinkingLevel": "minimal"}


class GeminiSTT(SpeechToText):
    name = "gemini"
    available = True

    def __init__(self, s: Settings):
        self.s = s
        self.g = _Gemini(s)

    async def transcribe(self, audio: bytes, mime: str, language_hint: str | None) -> STTResult:
        import base64

        hint = f" The speaker is expected to use {LANGUAGES[language_hint].name}, but detect the actual language." if language_hint in LANGUAGES else ""
        body = {
            "contents": [{"parts": [
                {"inlineData": {"mimeType": mime.split(";")[0] or "audio/webm", "data": base64.b64encode(audio).decode()}},
                {"text": "Transcribe this speech verbatim in its original language and script. Do not translate."
                         f"{hint} If there is no intelligible speech, return an empty text. "
                         "Return JSON: text, language (ISO 639-1 code), confidence (0-1)."},
            ]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": {"type": "OBJECT", "properties": {
                    "text": {"type": "STRING"}, "language": {"type": "STRING"}, "confidence": {"type": "NUMBER"}},
                    "required": ["text", "language", "confidence"]},
                "thinkingConfig": _Gemini.fast(self.s.gemini_stt_model),
            },
        }
        data = await self.g.generate(self.s.gemini_stt_model, body, "speech recognition")
        try:
            out = json.loads(_Gemini.text(data))
        except json.JSONDecodeError as e:
            raise ProviderError("Gemini speech recognition returned malformed output") from e
        conf = out.get("confidence")
        return STTResult(
            text=(out.get("text") or "").strip(),
            language=normalize(out.get("language")) or language_hint,
            confidence=round(max(0.0, min(1.0, float(conf))), 3) if isinstance(conf, (int, float)) else None,
            provider=f"gemini:{self.s.gemini_stt_model}",
        )


class GeminiTranslator(Translator):
    name = "gemini"

    def __init__(self, s: Settings):
        self.s = s
        self.g = _Gemini(s)

    async def translate(self, text, source, target, context, glossary) -> TranslationResult:
        src, tgt = LANGUAGES[source], LANGUAGES[target]
        ctx = "\n".join(f"[{lang}] {t}" for lang, t in context[-self.s.translation_context_utterances :]) or "(none)"
        terms = "\n".join(glossary) or "(none)"
        user = (
            f"Source language: {src.name} ({src.code})\nTarget language: {tgt.name} ({tgt.code})\n\n"
            f"Meeting terminology and participant names:\n{terms}\n\n"
            f"Preceding utterances (context only):\n{ctx}\n\n"
            f"Utterance to translate:\n<utterance>{text}</utterance>"
        )
        body = {
            "systemInstruction": {"parts": [{"text": _SYSTEM_PROMPT}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": {"type": "OBJECT", "properties": {
                    "translation": {"type": "STRING"}, "confidence": {"type": "NUMBER"},
                    "uncertain": {"type": "BOOLEAN"}, "uncertainty_notes": {"type": "STRING"}},
                    "required": ["translation", "confidence", "uncertain", "uncertainty_notes"]},
                "temperature": 0.2,
                "thinkingConfig": _Gemini.fast(self.s.gemini_model),
            },
        }
        resp = await self.g.generate(self.s.gemini_model, body, "translation")
        try:
            data = json.loads(_Gemini.text(resp))
        except json.JSONDecodeError as e:
            raise ProviderError("Translation provider returned malformed output") from e
        reasons = [data["uncertainty_notes"]] if data.get("uncertain") and data.get("uncertainty_notes") else []
        conf = float(data.get("confidence", 0))
        return TranslationResult(
            text=(data.get("translation") or "").strip(),
            confidence=conf,
            uncertain=bool(data.get("uncertain")) or conf < self.s.uncertainty_threshold,
            reasons=reasons or (["Low translation confidence"] if conf < self.s.uncertainty_threshold else []),
            provider=f"gemini:{self.s.gemini_model}",
        )


class GeminiTTS(TextToSpeech):
    name = "gemini-tts"

    def __init__(self, s: Settings):
        self.s = s
        self.g = _Gemini(s)

    async def synthesize(self, text, language, voice_id) -> TTSResult:
        import base64

        lang = LANGUAGES[language].name if language in LANGUAGES else language
        body = {
            "contents": [{"parts": [{"text": f"Say in {lang}, in a calm, formal interpreter's voice:\n{text}"}]}],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": self.s.gemini_tts_voice}}},
            },
        }
        # TTS models are separate; no text-model fallback here.
        g = self.g
        try:
            r = await g.client.post(f"{g.BASE}{self.s.gemini_tts_model}:generateContent", json=body)
        except httpx.HTTPError as e:
            raise ProviderError("Gemini TTS unreachable") from e
        if r.status_code >= 400:
            raise ProviderError(f"Gemini TTS error {r.status_code}: {r.text[:200]}")
        inline = next((p["inlineData"] for p in _Gemini.parts(r.json()) if "inlineData" in p), None)
        if not inline:
            raise ProviderError("Gemini TTS returned no audio")
        audio = base64.b64decode(inline["data"])
        mime = inline.get("mimeType", "")
        if not audio.startswith(b"RIFF"):  # raw 16-bit PCM (audio/L16): wrap it in a WAV header
            audio = _pcm_to_wav(audio, _pcm_rate(mime))
        return TTSResult(audio, "audio/wav", f"gemini:{self.s.gemini_tts_model}", "generic")


def _pcm_rate(mime: str) -> int:
    m = re.search(r"rate=(\d+)", mime)
    return int(m.group(1)) if m else 24000


def _pcm_to_wav(pcm: bytes, rate: int) -> bytes:
    import io
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


# ======================= registry =======================
@dataclass
class AIStack:
    stt: SpeechToText
    translator: Translator
    tts: TextToSpeech

    def status(self) -> dict:
        return {
            "stt": {"provider": self.stt.name, "server_available": self.stt.available},
            "translation": {"provider": self.translator.name, "simulated": self.translator.simulated},
            "tts": {"provider": self.tts.name, "voice_cloning": self.tts.clones_voice},
            "development_mode": self.translator.simulated,
        }


def build_stack(s: Settings | None = None) -> AIStack:
    s = s or get_settings()

    # In "auto", paid providers win when their key is set; Gemini covers whatever is left.
    stt: SpeechToText = SpeechToText()
    if s.stt_provider in ("auto", "openai") and s.openai_api_key:
        stt = OpenAIWhisperSTT(s)
    elif s.stt_provider in ("auto", "gemini") and s.gemini_api_key:
        stt = GeminiSTT(s)

    translator: Translator = DevGlossaryTranslator()
    if s.translation_provider in ("auto", "anthropic") and s.anthropic_api_key:
        translator = AnthropicTranslator(s)
    elif s.translation_provider in ("auto", "gemini") and s.gemini_api_key:
        translator = GeminiTranslator(s)
    elif s.translation_provider in ("anthropic", "gemini"):
        log.warning("WV_TRANSLATION_PROVIDER=%s but its API key is missing; using DEV glossary", s.translation_provider)

    generic: TextToSpeech = TextToSpeech()
    if s.tts_provider in ("auto", "openai", "elevenlabs") and s.openai_api_key:
        generic = OpenAITTS(s)
    elif s.tts_provider in ("auto", "gemini", "elevenlabs") and s.gemini_api_key:
        generic = GeminiTTS(s)
    tts: TextToSpeech = generic
    if s.tts_provider in ("auto", "elevenlabs") and s.elevenlabs_api_key:
        tts = ElevenLabsTTS(s, generic)
    elif s.tts_provider == "client":
        tts = TextToSpeech()

    stack = AIStack(stt, translator, tts)
    log.info("AI stack: %s", stack.status())
    return stack


# ======================= quality checks =======================
_DIGIT_MAP = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


def numbers_in(text: str) -> list[str]:
    return sorted(re.findall(r"\d+(?:[.,]\d+)?", text.translate(_DIGIT_MAP)))


def verify_numbers(source: str, translated: str) -> str | None:
    """Every number spoken must survive translation unchanged."""
    # CJK dates write the month as a number ("3月", "3월"); most target languages use a
    # month name instead, so the month digit is not required to survive.
    source = re.sub(r"\d{1,2}\s*(?:月|월)", " ", source)
    src, dst = numbers_in(source), numbers_in(translated)
    missing = [n for n in src if n not in dst]
    if missing:
        return f"Numbers in the original are missing from the translation: {', '.join(missing)}"
    return None
