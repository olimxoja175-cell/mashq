"""Reference data + (development only) demo accounts.

    python -m app.seed              # reference data (roles, permissions, languages, countries)
    python -m app.seed --demo       # + fictional demo officials (refused unless WV_DEV_MODE=true)
    python -m app.seed --admin EMAIL PASSWORD   # bootstrap the first administrator (production)

Demo officials are FICTIONAL people holding example offices; they are labelled "(demo)".
"""
from __future__ import annotations

import asyncio
import sys

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .ai.languages import LANGUAGES
from .config import get_settings
from .db import SessionLocal
from .models import Contact, Country, Language, OfficialProfile, Permission, Role, User, UserSettings, utcnow
from .security.auth import hash_password
from .security.crypto import encrypt

PERMISSIONS = {
    "meeting.create": "Create and schedule meetings",
    "meeting.join": "Join meetings the user is a participant of",
    "meeting.invite": "Invite authorized contacts to meetings",
    "contacts.manage": "Manage authorized contacts",
    "voice.enroll": "Enroll a consented voice identity profile",
    "admin.users": "Create, verify, suspend officials; reset MFA",
    "admin.access": "Manage roles and permissions",
    "audit.read": "Read the security audit log",
    "system.monitor": "View system health and latency metrics",
}

ROLES = {
    "head_of_state": ("Head of State / Government", ["meeting.create", "meeting.join", "meeting.invite", "contacts.manage", "voice.enroll"]),
    "diplomat": ("Diplomat / Minister", ["meeting.create", "meeting.join", "meeting.invite", "contacts.manage", "voice.enroll"]),
    "delegate": ("Authorized Delegate", ["meeting.join", "contacts.manage", "voice.enroll"]),
    "security_officer": ("Security Officer", ["meeting.join", "audit.read", "system.monitor"]),
    # Separation of duties: administrators do not take part in meetings by default.
    "admin": ("Platform Administrator", ["admin.users", "admin.access", "audit.read", "system.monitor"]),
}

COUNTRIES = [
    ("UZ", "Uzbekistan", "uz"), ("CN", "China", "zh"), ("GB", "United Kingdom", "en"), ("US", "United States", "en"),
    ("RU", "Russia", "ru"), ("SA", "Saudi Arabia", "ar"), ("EG", "Egypt", "ar"), ("AE", "United Arab Emirates", "ar"),
    ("FR", "France", "fr"), ("DE", "Germany", "de"), ("ES", "Spain", "es"), ("MX", "Mexico", "es"),
    ("TR", "Türkiye", "tr"), ("IR", "Iran", "fa"), ("IN", "India", "hi"), ("JP", "Japan", "ja"),
    ("KR", "Republic of Korea", "ko"), ("PT", "Portugal", "pt"), ("BR", "Brazil", "pt"), ("KZ", "Kazakhstan", "ru"),
    ("TJ", "Tajikistan", "fa"), ("CA", "Canada", "en"), ("IT", "Italy", "en"), ("CH", "Switzerland", "fr"),
]

DEMO_PASSWORD = "WorldVoice#2026"
DEMO_USERS = [
    # email, name, title, country, language, role
    ("uz.president@demo.worldvoice", "Akmal Rasulov (demo)", "President", "UZ", "uz", "head_of_state"),
    ("cn.president@demo.worldvoice", "Li Wenhua (demo)", "President", "CN", "zh", "head_of_state"),
    ("gb.pm@demo.worldvoice", "Eleanor Hart (demo)", "Prime Minister", "GB", "en", "head_of_state"),
    ("eg.president@demo.worldvoice", "Omar Haddad (demo)", "President", "EG", "ar", "head_of_state"),
    ("fr.minister@demo.worldvoice", "Claire Moreau (demo)", "Minister for Europe and Foreign Affairs", "FR", "fr", "diplomat"),
    ("security@demo.worldvoice", "Security Officer (demo)", "Chief Security Officer", "UZ", "en", "security_officer"),
    ("admin@demo.worldvoice", "Platform Administrator (demo)", "System Administrator", "UZ", "en", "admin"),
]
# Fixed TOTP secrets for demo accounts only, so authenticator apps can be paired from the README.
DEMO_TOTP = "JBSWY3DPEHPK3PXP"


async def seed_reference(db: AsyncSession) -> None:
    for code, l in LANGUAGES.items():
        if await db.get(Language, code) is None:
            db.add(Language(code=code, name=l.name, native_name=l.native, bcp47=l.bcp47, rtl=l.rtl))
    for code, desc in PERMISSIONS.items():
        if await db.get(Permission, code) is None:
            db.add(Permission(code=code, description=desc))
    await db.flush()
    for rid, (name, perms) in ROLES.items():
        if await db.get(Role, rid) is None:
            r = Role(id=rid, name=name, description=name)
            r.permissions = list((await db.execute(select(Permission).where(Permission.code.in_(perms)))).scalars())
            db.add(r)
    for code, name, lang in COUNTRIES:
        if await db.get(Country, code) is None:
            db.add(Country(code=code, name=name, default_language=lang))
    await db.commit()


async def create_user(db: AsyncSession, email, name, title, country, lang, role, password, totp_secret, verified=True) -> User:
    u = User(email=email, password_hash=hash_password(password), totp_secret_enc=encrypt(totp_secret, aad="totp"), role_id=role)
    db.add(u)
    await db.flush()
    db.add(OfficialProfile(user_id=u.id, full_name=name, title=title, country_code=country,
                           organization=f"Office of the {title}" if role == "head_of_state" else "",
                           identity_verified=verified, verified_at=utcnow() if verified else None))
    db.add(UserSettings(user_id=u.id, spoken_language=lang, listen_language=lang, ui_language=lang))
    await db.flush()
    return u


async def seed_demo(db: AsyncSession) -> bool:
    if (await db.execute(select(User).limit(1))).scalar_one_or_none():
        return False
    users = []
    for email, name, title, country, lang, role in DEMO_USERS:
        users.append(await create_user(db, email, name, title, country, lang, role, DEMO_PASSWORD, DEMO_TOTP))
    officials = [u for u in users if u.role_id in ("head_of_state", "diplomat")]
    for a in officials:
        for b in officials:
            if a.id != b.id:
                db.add(Contact(owner_id=a.id, contact_user_id=b.id, note="Demo authorized contact"))
    await db.commit()
    return True


async def main(argv: list[str]) -> None:
    from .db import Base, engine

    async with engine.begin() as conn:  # no-op when Alembic has already created the schema
        await conn.run_sync(Base.metadata.create_all)
    async with SessionLocal() as db:
        await seed_reference(db)
        if "--demo" in argv:
            if not get_settings().dev_mode:
                sys.exit("Refusing to create demo accounts when WV_DEV_MODE=false")
            print("demo accounts created" if await seed_demo(db) else "users already exist; demo seed skipped")
        if "--admin" in argv:
            i = argv.index("--admin")
            email, password = argv[i + 1], argv[i + 2]
            import pyotp

            from .security.auth import validate_password_strength

            validate_password_strength(password)
            secret = pyotp.random_base32()
            await create_user(db, email.lower(), "Platform Administrator", "System Administrator", "UZ", "en", "admin",
                              password, secret)
            await db.commit()
            print("Administrator created. Authenticator secret (store securely, shown once):", secret)
    print("reference data ready")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:]))
