import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _get_secret_key() -> bytes:
    secret = os.getenv("ENCRYPTION_SECRET")
    if not secret:
        raise RuntimeError("ENCRYPTION_SECRET is not set in .env")
    raw = bytes.fromhex(secret)
    if len(raw) not in (16, 24, 32):
        raise RuntimeError("ENCRYPTION_SECRET must be a 32, 48, or 64-char hex string (16/24/32 bytes)")
    return raw


def encrypt_key(plain_text: str) -> str:
    key = _get_secret_key()
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, plain_text.encode(), None)
    # store as base64(nonce + ciphertext)
    return base64.b64encode(nonce + ciphertext).decode()


def decrypt_key(cipher_text: str) -> str:
    key = _get_secret_key()
    aesgcm = AESGCM(key)
    raw = base64.b64decode(cipher_text)
    nonce, ciphertext = raw[:12], raw[12:]
    return aesgcm.decrypt(nonce, ciphertext, None).decode()


def mask_key(plain_text: str) -> str:
    if len(plain_text) <= 10:
        return "*" * len(plain_text)
    return f"{plain_text[:6]}...{plain_text[-4:]}"
