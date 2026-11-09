"""Requirement tests 1–7, 9, 12: translation pairs, multi-party routing, voice identity,
controls, reconnection. AI here is the clearly-labelled DEV phrase table (no keys)."""
from __future__ import annotations

import asyncio
import uuid

import pytest

from app.ai.providers import AIStack, DevGlossaryTranslator, SpeechToText, TextToSpeech, TTSResult
from app.realtime import pipeline

from .conftest import join, new_meeting


def is_tr(uid):
    return lambda m: m["type"] == "translation" and m["utterance_id"] == uid


async def speak(peer, text, lang):
    uid = uuid.uuid4().hex
    await peer.send({"type": "speech.text", "utterance_id": uid, "text": text, "language": lang, "confidence": 0.95})
    return uid


@pytest.mark.parametrize("src,dst,text,expected", [
    ("uz", "zh", "Xayrli kun, janob Prezident.", "下午好，总统先生。"),
    ("zh", "uz", "我们愿意加强我们两国之间的合作。", "Biz mamlakatlarimiz oʻrtasidagi hamkorlikni mustahkamlashga tayyormiz."),
    ("uz", "en", "Kelishuvni 2027-yil 15-martda imzolashni taklif qilaman.", "I propose that we sign the agreement on 15 March 2027."),
    ("en", "uz", "Thank you for your warm welcome.", "Iliq kutib olganingiz uchun rahmat."),
])
async def test_translation_pairs(login, src, dst, text, expected):
    """Tests 1–4: Uzbek↔Chinese, Uzbek↔English through the full live pipeline."""
    speaker_key = {"uz": "uz", "zh": "zh", "en": "en"}[src]
    listener_key = {"uz": "uz", "zh": "zh", "en": "en"}[dst]
    a, b = await login(speaker_key), await login(listener_key)
    mid = await new_meeting(a, [b])
    pa = await join(a, mid, spoken=src)
    pb = await join(b, mid, spoken=dst)
    try:
        uid = await speak(pa, text, src)
        msg = await pb.recv_until(is_tr(uid))
        assert msg["text"] == expected
        assert msg["source_language"] == src and msg["target_language"] == dst
        assert msg["original_text"] == text  # original always delivered alongside
        assert msg["simulated"] is True and msg["provider"] == "dev-glossary"
        assert msg["uncertain"] is False
        assert msg["synthetic_voice"] is True
        # the listener also receives the original-language transcript
        orig = await pb.recv_until(lambda m: m["type"] == "transcript" and m["utterance_id"] == uid)
        assert orig["text"] == text
    finally:
        await pa.ws.close(); await pb.ws.close()


async def test_four_party_routing_and_no_self_audio(login):
    """Tests 5–6: four officials, four languages; each hears their own language only;
    the speaker never receives their own translation."""
    uz, zh, en, ar = [await login(k) for k in ("uz", "zh", "en", "ar")]
    mid = await new_meeting(uz, [zh, en, ar])
    peers = {k: await join(c, mid, spoken=k) for k, c in (("uz", uz), ("zh", zh), ("en", en), ("ar", ar))}
    try:
        for speaker in ("uz", "zh"):
            from app.ai.dev_glossary import PHRASES
            phrase = PHRASES[3]
            uid = await speak(peers[speaker], phrase[speaker], speaker)
            for lst, peer in peers.items():
                if lst == speaker:
                    continue
                m = await peer.recv_until(is_tr(uid))
                assert m["target_language"] == lst
                assert m["text"] == phrase[lst]
            got = await peers[speaker].drain(0.6)
            assert not [m for m in got if m["type"] == "translation"], "speaker must not receive own translation"
            assert [m for m in got if m["type"] == "transcript" and m["utterance_id"] == uid]
            for p in peers.values():
                await p.drain(0.2)
    finally:
        for p in peers.values():
            await p.ws.close()


async def test_same_language_listener_gets_no_translation(login):
    uz, zh, en = await login("uz"), await login("zh"), await login("en")
    mid = await new_meeting(en, [uz, zh])
    p_en = await join(en, mid, spoken="en")
    p_uz = await join(uz, mid, spoken="uz", listen="en")  # Uzbek official chose to listen in English
    p_zh = await join(zh, mid, spoken="zh")
    try:
        uid = await speak(p_en, "Can you hear me well?", "en")
        m = await p_zh.recv_until(is_tr(uid))
        assert m["text"] == "您能听清楚我说话吗？"
        got = await p_uz.drain(0.6)
        assert not [x for x in got if x["type"] == "translation"]  # hears original English
    finally:
        for p in (p_en, p_uz, p_zh):
            await p.ws.close()


async def test_unknown_sentence_is_flagged_not_guessed(login):
    uz, zh = await login("uz"), await login("zh")
    mid = await new_meeting(uz, [zh])
    pa, pb = await join(uz, mid, spoken="uz"), await join(zh, mid, spoken="zh")
    try:
        text = "Bu jumla demo lug'atida yo'q."
        uid = await speak(pa, text, "uz")
        m = await pb.recv_until(is_tr(uid))
        assert m["uncertain"] is True
        assert m["text"] == text and m["original_text"] == text
        assert m["speak"] is False  # untranslated text is never voiced as if translated
        assert any("DEVELOPMENT MODE" in r for r in m["uncertainty_reasons"])
    finally:
        await pa.ws.close(); await pb.ws.close()


async def test_low_stt_confidence_warns(login):
    uz, en = await login("uz"), await login("en")
    mid = await new_meeting(uz, [en])
    pa, pb = await join(uz, mid, spoken="uz"), await join(en, mid, spoken="en")
    try:
        uid = uuid.uuid4().hex
        await pa.send({"type": "speech.text", "utterance_id": uid, "text": "Rahmat. Xayr.", "language": "uz", "confidence": 0.4})
        m = await pb.recv_until(is_tr(uid))
        assert m["uncertain"] and "misheard" in m["uncertainty_reasons"][0]
    finally:
        await pa.ws.close(); await pb.ws.close()


async def test_duplicate_utterance_not_retranslated(login):
    uz, zh = await login("uz"), await login("zh")
    mid = await new_meeting(uz, [zh])
    pa, pb = await join(uz, mid, spoken="uz"), await join(zh, mid, spoken="zh")
    try:
        uid = uuid.uuid4().hex
        for _ in range(3):
            await pa.send({"type": "speech.text", "utterance_id": uid, "text": "Rahmat. Xayr.", "language": "uz"})
        got = await pb.drain(1.0)
        assert len([m for m in got if m["type"] == "translation"]) == 1
    finally:
        await pa.ws.close(); await pb.ws.close()


class RecordingTTS(TextToSpeech):
    name = "fake-clone"
    clones_voice = True

    def __init__(self):
        self.calls = []

    async def synthesize(self, text, language, voice_id):
        self.calls.append((voice_id, language, text))
        return TTSResult(b"ID3fake-mp3", "audio/mpeg", self.name, "profile" if voice_id else "generic")


async def test_voice_identity_bound_to_speaker(login):
    """Test 7: synthesis uses ONLY the speaker's own consented voice profile."""
    from app.realtime.hub import hub

    tts = RecordingTTS()
    pipeline.set_stack(AIStack(SpeechToText(), DevGlossaryTranslator(), tts))
    uz, zh = await login("uz"), await login("zh")
    mid = await new_meeting(uz, [zh])
    pa, pb = await join(uz, mid, spoken="uz"), await join(zh, mid, spoken="zh")
    try:
        room = hub.room(mid)
        room.participants[uz.id].voice_id = "VOICE-UZ"   # consented profiles (as loaded at join)
        room.participants[zh.id].voice_id = "VOICE-ZH"
        u1 = await speak(pa, "Rahmat. Xayr.", "uz")
        m1 = await pb.recv_until(is_tr(u1))
        u2 = await speak(pb, "谢谢。再见。", "zh")
        m2 = await pa.recv_until(is_tr(u2))
        assert m1["voice_mode"] == "profile" and m1["audio"] and m1["audio_mime"] == "audio/mpeg"
        assert ("VOICE-UZ", "zh", "谢谢。再见。") in tts.calls
        assert ("VOICE-ZH", "uz", "Rahmat. Xayr.") in tts.calls
        assert all(not (v == "VOICE-UZ" and t == "Rahmat. Xayr.") for v, _, t in tts.calls)
        # participant without a profile -> generic voice, explicitly labelled
        room.participants[uz.id].voice_id = None
        u3 = await speak(pa, "Meni yaxshi eshityapsizmi?", "uz")
        m3 = await pb.recv_until(is_tr(u3))
        assert m3["voice_mode"] == "generic"
        assert m2["latency"]["total_ms"] >= 0
    finally:
        pipeline.set_stack(None)
        await pa.ws.close(); await pb.ws.close()


async def test_per_speaker_order_preserved(login):
    """Test 8 (server side): utterances of one speaker arrive in spoken order with latency metadata."""
    uz, en = await login("uz"), await login("en")
    mid = await new_meeting(uz, [en])
    pa, pb = await join(uz, mid, spoken="uz"), await join(en, mid, spoken="en")
    try:
        from app.ai.dev_glossary import PHRASES
        uids = [await speak(pa, PHRASES[i]["uz"], "uz") for i in range(5)]
        got = []
        while len(got) < 5:
            m = await pb.recv_until(lambda m: m["type"] == "translation")
            got.append(m["utterance_id"])
            assert set(m["latency"]) == {"stt_ms", "mt_ms", "tts_ms", "total_ms"}
        assert got == uids
    finally:
        await pa.ws.close(); await pb.ws.close()


async def test_mic_camera_state_broadcast(login):
    """Test 9."""
    uz, zh = await login("uz"), await login("zh")
    mid = await new_meeting(uz, [zh])
    pa, pb = await join(uz, mid, spoken="uz"), await join(zh, mid, spoken="zh")
    try:
        await pa.send({"type": "state", "mic": False, "cam": False})
        m = await pb.recv_until(lambda m: m["type"] == "participant.state")
        assert m == {"type": "participant.state", "user_id": uz.id, "mic": False, "cam": False, "hand": False}
    finally:
        await pa.ws.close(); await pb.ws.close()


async def test_signalling_relay_only_to_target(login):
    uz, zh, en = await login("uz"), await login("zh"), await login("en")
    mid = await new_meeting(uz, [zh, en])
    pa, pb, pc = await join(uz, mid, spoken="uz"), await join(zh, mid, spoken="zh"), await join(en, mid, spoken="en")
    try:
        await pa.send({"type": "signal", "to": zh.id, "data": {"sdp": {"type": "offer", "sdp": "v=0"}}})
        m = await pb.recv_until(lambda m: m["type"] == "signal")
        assert m["from"] == uz.id and m["data"]["sdp"]["type"] == "offer"
        assert not [x for x in await pc.drain(0.4) if x["type"] == "signal"]
    finally:
        for p in (pa, pb, pc):
            await p.ws.close()


async def test_reconnect_replaces_connection_and_replay_dropped(login):
    """Test 12: network interruption -> reconnect with a fresh ticket."""
    uz, zh = await login("uz"), await login("zh")
    mid = await new_meeting(uz, [zh])
    pa = await join(uz, mid, spoken="uz")
    pb = await join(zh, mid, spoken="zh")
    try:
        pa2 = await join(uz, mid, spoken="uz")  # same user reconnects
        assert pa2.welcome["reconnected"] is True
        m = await pb.recv_until(lambda m: m["type"] == "participant.joined")
        assert m["reconnected"] is True
        # replayed sequence number is ignored
        uid = uuid.uuid4().hex
        await pa2.send({"type": "speech.text", "utterance_id": uid, "text": "Rahmat. Xayr.", "language": "uz"})
        await pb.recv_until(is_tr(uid))
        pa2.seq -= 1  # resend with an old seq
        await pa2.send({"type": "speech.text", "utterance_id": uuid.uuid4().hex, "text": "Rahmat. Xayr.", "language": "uz"})
        assert not [x for x in await pb.drain(0.6) if x["type"] == "translation"]
        await pa2.ws.close()
    finally:
        await pb.ws.close()
        try:
            await pa.ws.close()
        except Exception:
            pass


async def test_no_ai_consent_no_processing(login):
    uz, zh = await login("uz"), await login("zh")
    mid = await new_meeting(uz, [zh])
    pa = await join(uz, mid, spoken="uz", consent=False)
    pb = await join(zh, mid, spoken="zh")
    try:
        await pa.send({"type": "speech.text", "utterance_id": "x1", "text": "Rahmat. Xayr.", "language": "uz"})
        err = await pa.recv_until(lambda m: m["type"] == "error")
        assert err["code"] == "ai_consent_required"
        assert not [x for x in await pb.drain(0.4) if x["type"] in ("translation", "transcript")]
    finally:
        await pa.ws.close(); await pb.ws.close()
