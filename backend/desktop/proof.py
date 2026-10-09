"""The arithmetic the app and the server must agree on to the byte.

Pure functions only — no models, no requests — so the other half (``desktop/src-tauri/src/proof.rs``)
can be checked against the same vectors (``tests_desktop.ProofVectorTests``).

The proof says: "the app build holding key ``key_id`` was locked down when it answered challenge
``nonce`` for sitting ``attempt_id``". Its strength is the key's secrecy, and the key ships inside
the .exe — so it stops a student opening a midterm in Chrome, and it does not stop someone who
reverse-engineers the build. Keys therefore rotate with releases (``DESKTOP_PROOF_KEYS`` holds
every key still accepted) and a build's version is part of what is signed.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

PROOF_VERSION = "mastersat-lockdown-v1"

#: The app sends its pre-check as a JSON string. It is signed as sent and stored parsed; anything
#: longer than this is not a pre-check.
MAX_PRECHECK_CHARS = 4096


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def new_secret() -> str:
    """A random, URL-safe token: challenges, session tokens, sign-in codes."""
    return secrets.token_urlsafe(32)


def proof_message(*, attempt_id: int, nonce: str, app_version: str, precheck: str) -> bytes:
    return "\n".join([PROOF_VERSION, str(int(attempt_id)), nonce, app_version, precheck]).encode("utf-8")


def sign(*, secret_hex: str, attempt_id: int, nonce: str, app_version: str, precheck: str) -> str:
    message = proof_message(attempt_id=attempt_id, nonce=nonce, app_version=app_version, precheck=precheck)
    return hmac.new(bytes.fromhex(secret_hex), message, hashlib.sha256).hexdigest()


def verify(
    *,
    keys: dict[str, str],
    key_id: str,
    mac: str,
    attempt_id: int,
    nonce: str,
    app_version: str,
    precheck: str,
) -> bool:
    secret_hex = keys.get(key_id or "")
    if not secret_hex or not isinstance(mac, str):
        return False
    try:
        expected = sign(
            secret_hex=secret_hex, attempt_id=attempt_id, nonce=nonce, app_version=app_version, precheck=precheck
        )
    except ValueError:
        # A key that is not hex is a configuration mistake, never a match.
        return False
    return hmac.compare_digest(expected, mac.strip().lower())


def pkce_challenge(verifier: str) -> str:
    """RFC 7636 S256: base64url(sha256(verifier)) without padding."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def parse_keys(raw: str | None) -> dict[str, str]:
    """``"k1:9f…,k2:3a…"`` → ``{"k1": "9f…", "k2": "3a…"}``. Malformed entries are dropped."""
    keys: dict[str, str] = {}
    for part in (raw or "").split(","):
        key_id, sep, secret_hex = part.strip().partition(":")
        if not sep or not key_id or not secret_hex:
            continue
        try:
            bytes.fromhex(secret_hex)
        except ValueError:
            continue
        keys[key_id.strip()] = secret_hex.strip().lower()
    return keys
