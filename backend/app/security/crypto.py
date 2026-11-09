"""Encryption at rest (AES-256-GCM) and token helpers.

Ciphertext format: "<key_id>:<base64(nonce||ciphertext||tag)>". The key id allows
key rotation: decrypt() looks up the key by id. In production the data key should
be delivered from a KMS / Vault secret, never committed."""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import time

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from ..config import get_settings


def _keys() -> dict[str, bytes]:
    s = get_settings()
    return {s.data_key_id: s.resolved_data_key()}


def encrypt(plaintext: str, aad: str = "") -> str:
    s = get_settings()
    key = _keys()[s.data_key_id]
    nonce = os.urandom(12)
    ct = AESGCM(key).encrypt(nonce, plaintext.encode("utf-8"), aad.encode() or None)
    return f"{s.data_key_id}:{base64.b64encode(nonce + ct).decode()}"


def decrypt(token: str, aad: str = "") -> str:
    key_id, _, payload = token.partition(":")
    key = _keys().get(key_id)
    if key is None:
        raise ValueError("unknown data key id")
    raw = base64.b64decode(payload)
    return AESGCM(key).decrypt(raw[:12], raw[12:], aad.encode() or None).decode("utf-8")


def sha256_hex(value: str | bytes) -> str:
    if isinstance(value, str):
        value = value.encode()
    return hashlib.sha256(value).hexdigest()


def random_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def sign(payload: str) -> str:
    return hmac.new(get_settings().resolved_secret_key(), payload.encode(), hashlib.sha256).hexdigest()


def make_signed_token(kind: str, subject: str, ttl_seconds: int) -> str:
    """Short-lived signed token: kind.subject.expiry.nonce.sig"""
    exp = int(time.time()) + ttl_seconds
    nonce = secrets.token_urlsafe(12)
    body = f"{kind}.{subject}.{exp}.{nonce}"
    return f"{body}.{sign(body)}"


def verify_signed_token(token: str, kind: str) -> tuple[str, str] | None:
    """Returns (subject, nonce) if valid and unexpired, else None."""
    parts = token.split(".")
    if len(parts) != 5:
        return None
    k, subject, exp, nonce, sig = parts
    body = f"{k}.{subject}.{exp}.{nonce}"
    if k != kind or not hmac.compare_digest(sign(body), sig):
        return None
    try:
        if int(exp) < time.time():
            return None
    except ValueError:
        return None
    return subject, nonce
