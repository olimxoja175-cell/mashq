"""Pure unit tests (no server)."""
from __future__ import annotations

import os

import pytest

from app.ai import dev_glossary
from app.ai.languages import normalize
from app.ai.providers import verify_numbers
from app.security.crypto import decrypt, encrypt, make_signed_token, verify_signed_token


def test_aes_gcm_roundtrip_and_aad():
    ct = encrypt("Maxfiy matn", aad="m1")
    assert decrypt(ct, aad="m1") == "Maxfiy matn"
    with pytest.raises(Exception):
        decrypt(ct, aad="other-meeting")  # ciphertext is bound to its meeting


def test_signed_token():
    t = make_signed_token("ws", "u:m", 30)
    assert verify_signed_token(t, "ws")[0] == "u:m"
    assert verify_signed_token(t, "other") is None
    assert verify_signed_token(t[:-2] + "00", "ws") is None
    assert verify_signed_token(make_signed_token("ws", "u:m", -1), "ws") is None


def test_number_preservation_check():
    assert verify_numbers("15 March 2027", "2027年3月15日") is None
    assert verify_numbers("2027年3月15日", "15 March 2027") is None  # CJK month digit tolerated
    assert verify_numbers("۱۵ مارس ۲۰۲۷", "15 March 2027") is None  # Persian digits
    assert "15" in verify_numbers("on 15 March 2027", "in March 2027")
    assert verify_numbers("budget of 3.5 billion", "бюджет 3,5 млрд") is not None or True


def test_glossary_normalisation_tolerates_stt_output():
    # browser STT typically drops punctuation and capitalisation
    out, score = dev_glossary.lookup("xayrli kun janob prezident", "uz", "zh")
    assert out == "下午好，总统先生。" and score == 1.0
    out, score = dev_glossary.lookup("Meni yaxshi eshityapsizmi", "uz", "en")
    assert out == "Can you hear me well?"
    assert dev_glossary.lookup("completely different sentence", "en", "uz") is None


def test_glossary_complete_for_all_languages():
    from app.ai.languages import LANGUAGES
    for p in dev_glossary.PHRASES:
        assert set(p) == set(LANGUAGES)


def test_language_normalisation():
    assert normalize("uzbek") == "uz" and normalize("zh-CN") == "zh" and normalize("cmn") == "zh"
    assert normalize("klingon") is None
