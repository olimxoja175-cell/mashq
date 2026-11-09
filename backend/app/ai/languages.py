"""Language registry. Adding a language = one entry here (+ seed/migration row)."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LanguageInfo:
    code: str  # ISO 639-1
    name: str
    native: str
    bcp47: str  # used by browser speech APIs
    rtl: bool = False
    whisper_name: str = ""  # name returned by Whisper verbose_json language detection


LANGUAGES: dict[str, LanguageInfo] = {
    l.code: l
    for l in [
        LanguageInfo("uz", "Uzbek", "Oʻzbekcha", "uz-UZ", whisper_name="uzbek"),
        LanguageInfo("zh", "Mandarin Chinese", "中文", "zh-CN", whisper_name="chinese"),
        LanguageInfo("en", "English", "English", "en-US", whisper_name="english"),
        LanguageInfo("ru", "Russian", "Русский", "ru-RU", whisper_name="russian"),
        LanguageInfo("ar", "Arabic", "العربية", "ar-SA", rtl=True, whisper_name="arabic"),
        LanguageInfo("fr", "French", "Français", "fr-FR", whisper_name="french"),
        LanguageInfo("de", "German", "Deutsch", "de-DE", whisper_name="german"),
        LanguageInfo("es", "Spanish", "Español", "es-ES", whisper_name="spanish"),
        LanguageInfo("tr", "Turkish", "Türkçe", "tr-TR", whisper_name="turkish"),
        LanguageInfo("fa", "Persian", "فارسی", "fa-IR", rtl=True, whisper_name="persian"),
        LanguageInfo("hi", "Hindi", "हिन्दी", "hi-IN", whisper_name="hindi"),
        LanguageInfo("ja", "Japanese", "日本語", "ja-JP", whisper_name="japanese"),
        LanguageInfo("ko", "Korean", "한국어", "ko-KR", whisper_name="korean"),
        LanguageInfo("pt", "Portuguese", "Português", "pt-PT", whisper_name="portuguese"),
    ]
}

_BY_WHISPER = {l.whisper_name: l.code for l in LANGUAGES.values()}


def normalize(code_or_name: str | None) -> str | None:
    if not code_or_name:
        return None
    v = code_or_name.strip().lower()
    if v in LANGUAGES:
        return v
    if v in _BY_WHISPER:
        return _BY_WHISPER[v]
    v2 = v.split("-")[0].split("_")[0]
    if v2 in LANGUAGES:
        return v2
    if v2 == "cmn":
        return "zh"
    return None


def is_supported(code: str) -> bool:
    return code in LANGUAGES
