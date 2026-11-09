"""DEV ONLY: fictional test data so the UI has something to show.

    python -m app.seed_test          # add (idempotent: skipped if already present)
    python -m app.seed_test --remove # delete everything this script added

Everything added is marked: users use @test.worldvoice, meeting titles start with "[TEST]".
"""
from __future__ import annotations

import asyncio
import sys
from datetime import timedelta

from sqlalchemy import delete, select

from .config import get_settings
from .db import SessionLocal
from .models import (Contact, Invitation, Meeting, MeetingParticipant, Transcript, TranslationEvent, User, utcnow)
from .security.auth import random_token
from .security.crypto import encrypt, sha256_hex
from .seed import DEMO_PASSWORD, DEMO_TOTP, create_user

TAG = "[TEST]"
DOMAIN = "@test.worldvoice"

TEST_USERS = [
    ("kz.president@test.worldvoice", "Nurlan Abenov (test)", "President", "KZ", "ru", "head_of_state"),
    ("tr.president@test.worldvoice", "Emre Kaya (test)", "President", "TR", "tr", "head_of_state"),
    ("jp.pm@test.worldvoice", "Hiroshi Tanaka (test)", "Prime Minister", "JP", "ja", "head_of_state"),
    ("de.minister@test.worldvoice", "Anna Becker (test)", "Federal Foreign Minister", "DE", "de", "diplomat"),
    ("in.minister@test.worldvoice", "Ravi Mehta (test)", "Minister of External Affairs", "IN", "hi", "diplomat"),
    ("uz.delegate@test.worldvoice", "Dilnoza Karimova (test)", "Deputy Foreign Minister", "UZ", "uz", "delegate"),
]

# (host email, title, agenda, status, start offset hours, duration h, participant emails, security)
MEETINGS = [
    ("uz.president@demo.worldvoice", "Uzbekistan–Kazakhstan water resources talks", "Shared rivers, irrigation quotas, joint monitoring.",
     "scheduled", 2, 1, ["kz.president@test.worldvoice", "uz.delegate@test.worldvoice"], "confidential"),
    ("uz.president@demo.worldvoice", "Central Asia – Türkiye trade corridor", "Middle Corridor logistics, tariffs, rail capacity.",
     "scheduled", 26, 2, ["tr.president@test.worldvoice", "kz.president@test.worldvoice", "de.minister@test.worldvoice"], "standard"),
    ("cn.president@demo.worldvoice", "Green energy cooperation", "Solar and wind investment, grid interconnection.",
     "scheduled", 50, 1, ["uz.president@demo.worldvoice", "jp.pm@test.worldvoice"], "confidential"),
    ("gb.pm@demo.worldvoice", "Education exchange programme", "University scholarships and English teacher exchange.",
     "scheduled", 74, 1, ["uz.president@demo.worldvoice", "in.minister@test.worldvoice"], "standard"),
    ("uz.president@demo.worldvoice", "Uzbekistan–Japan technology partnership", "Semiconductor training, IT parks.",
     "ended", -48, 1, ["jp.pm@test.worldvoice", "uz.delegate@test.worldvoice"], "confidential"),
    ("fr.minister@demo.worldvoice", "Cultural heritage protection", "Restoration of Samarkand and Bukhara monuments.",
     "ended", -120, 1, ["uz.president@demo.worldvoice", "eg.president@demo.worldvoice"], "standard"),
    ("eg.president@demo.worldvoice", "Tourism visa facilitation", "Simplified visas, direct flights.",
     "cancelled", -24, 1, ["uz.president@demo.worldvoice"], "standard"),
]

# pending invitations: (meeting index, inviter, invitee, message) — invitee is NOT yet a participant
INVITES = [
    (1, "uz.president@demo.worldvoice", "gb.pm@demo.worldvoice", "We would value the UK's view on the corridor."),
    (2, "cn.president@demo.worldvoice", "fr.minister@demo.worldvoice", "Please join our energy discussion."),
    (3, "gb.pm@demo.worldvoice", "cn.president@demo.worldvoice", "Join us to discuss education exchanges."),
    (0, "uz.president@demo.worldvoice", "tr.president@test.worldvoice", "Observer seat offered."),
]

# transcripts for ended meetings: meeting index -> [(speaker, lang, text, [(target, translation)])]
TRANSCRIPTS = {
    4: [
        ("uz.president@demo.worldvoice", "uz", "Hurmatli janob Bosh vazir, uchrashuvimizga xush kelibsiz.",
         [("ja", "首相閣下、会談へようこそ。"), ("en", "Honourable Prime Minister, welcome to our meeting.")]),
        ("jp.pm@test.worldvoice", "ja", "ありがとうございます。技術協力を強化したいと思います。",
         [("uz", "Rahmat. Texnologik hamkorlikni kuchaytirmoqchimiz."), ("en", "Thank you. We want to strengthen technology cooperation.")]),
        ("uz.delegate@test.worldvoice", "uz", "IT parklarda yapon kompaniyalari uchun imtiyozlar tayyorladik.",
         [("ja", "ITパークで日本企業向けの優遇措置を用意しました。"), ("en", "We prepared incentives for Japanese companies in IT parks.")]),
    ],
    5: [
        ("fr.minister@demo.worldvoice", "fr", "La France est prête à soutenir la restauration de Samarcande.",
         [("uz", "Fransiya Samarqandni ta'mirlashni qo'llab-quvvatlashga tayyor."), ("ar", "فرنسا مستعدة لدعم ترميم سمرقند.")]),
        ("uz.president@demo.worldvoice", "uz", "Bu tashabbusni mamnuniyat bilan qabul qilamiz.",
         [("fr", "Nous accueillons cette initiative avec plaisir."), ("ar", "نرحب بهذه المبادرة بكل سرور.")]),
    ],
}


async def add() -> None:
    async with SessionLocal() as db:
        if (await db.execute(select(User).where(User.email.like(f"%{DOMAIN}")).limit(1))).scalar_one_or_none():
            print("test data already present; run with --remove first to recreate")
            return
        for email, name, title, country, lang, role in TEST_USERS:
            await create_user(db, email, name, title, country, lang, role, DEMO_PASSWORD, DEMO_TOTP)
        users = {u.email: u for u in (await db.execute(select(User))).scalars()}

        # authorized contacts between every official / delegate (both directions), skipping existing pairs
        people = [u for u in users.values() if u.role_id in ("head_of_state", "diplomat", "delegate")]
        existing = {(c.owner_id, c.contact_user_id) for c in (await db.execute(select(Contact))).scalars()}
        for a in people:
            for b in people:
                if a.id != b.id and (a.id, b.id) not in existing:
                    db.add(Contact(owner_id=a.id, contact_user_id=b.id, note="Test authorized contact"))

        now = utcnow()
        meetings = []
        for host, title, agenda, status, off, dur, parts, level in MEETINGS:
            start = now + timedelta(hours=off)
            m = Meeting(title=f"{TAG} {title}", agenda=agenda, host_id=users[host].id, status=status, security_level=level,
                        scheduled_start=start, scheduled_end=start + timedelta(hours=dur))
            if status == "ended":
                m.started_at, m.ended_at = start, start + timedelta(hours=dur)
            db.add(m)
            await db.flush()
            for email in [host, *parts]:
                st = users[email].settings
                db.add(MeetingParticipant(meeting_id=m.id, user_id=users[email].id, role="host" if email == host else "participant",
                                          spoken_language=st.spoken_language, listen_language=st.listen_language,
                                          ai_consent=status == "ended", joined_at=m.started_at, left_at=m.ended_at))
            meetings.append(m)

        for idx, inviter, invitee, msg in INVITES:
            db.add(Invitation(meeting_id=meetings[idx].id, inviter_id=users[inviter].id, invitee_id=users[invitee].id,
                              token_hash=sha256_hex(random_token(24)), message=msg, expires_at=now + timedelta(days=7)))

        for idx, lines in TRANSCRIPTS.items():
            m = meetings[idx]
            for n, (speaker, lang, text, translations) in enumerate(lines):
                tr = Transcript(meeting_id=m.id, speaker_id=users[speaker].id, utterance_id=f"test-{n}", source_language=lang,
                                text_enc=encrypt(text, aad=m.id), stt_provider="test", confidence=0.95,
                                created_at=m.started_at + timedelta(minutes=2 + n * 3))
                db.add(tr)
                await db.flush()
                for target, ttext in translations:
                    db.add(TranslationEvent(transcript_id=tr.id, meeting_id=m.id, target_language=target,
                                            text_enc=encrypt(ttext, aad=m.id), provider="test", tts_provider="test",
                                            voice_mode="generic", confidence=0.93, stt_ms=420, mt_ms=610, tts_ms=380,
                                            total_ms=1410, created_at=tr.created_at))
        await db.commit()
        print(f"added {len(TEST_USERS)} users, {len(meetings)} meetings, {len(INVITES)} invitations, "
              f"{sum(len(v) for v in TRANSCRIPTS.values())} transcript lines")


async def remove() -> None:
    async with SessionLocal() as db:
        mids = list((await db.execute(select(Meeting.id).where(Meeting.title.like(f"{TAG}%")))).scalars())
        uids = list((await db.execute(select(User.id).where(User.email.like(f"%{DOMAIN}")))).scalars())
        if mids:
            for model in (TranslationEvent, Transcript, Invitation, MeetingParticipant):
                await db.execute(delete(model).where(model.meeting_id.in_(mids)))
            await db.execute(delete(Meeting).where(Meeting.id.in_(mids)))
        if uids:
            await db.execute(delete(Contact).where(Contact.owner_id.in_(uids) | Contact.contact_user_id.in_(uids)))
            await db.execute(delete(Invitation).where(Invitation.invitee_id.in_(uids) | Invitation.inviter_id.in_(uids)))
            await db.execute(delete(MeetingParticipant).where(MeetingParticipant.user_id.in_(uids)))
            for u in (await db.execute(select(User).where(User.id.in_(uids)))).scalars():
                await db.delete(u)
        await db.execute(delete(Contact).where(Contact.note == "Test authorized contact"))
        await db.commit()
        print(f"removed {len(mids)} test meetings and {len(uids)} test users")


if __name__ == "__main__":
    if not get_settings().dev_mode:
        sys.exit("Refusing: test data only in WV_DEV_MODE=true")
    asyncio.run(remove() if "--remove" in sys.argv else add())
