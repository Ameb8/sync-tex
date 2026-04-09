"""
AES-256-GCM encryption for LLM API keys.

The encryption key is loaded from the ASSISTANT_ENCRYPTION_KEY environment
variable, which must be a 32-byte value encoded as hex (64 hex chars).

Generate one with:
    python -c "import secrets; print(secrets.token_hex(32))"
"""

import os
import secrets
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_NONCE_SIZE = 12  # 96-bit nonce, standard for GCM


def _load_key() -> bytes:
    hex_key = os.getenv("ASSISTANT_ENCRYPTION_KEY", "")
    if len(hex_key) != 64:
        raise RuntimeError(
            "ASSISTANT_ENCRYPTION_KEY must be set to a 64-char hex string (32 bytes). "
            "Generate with: python -c \"import secrets; print(secrets.token_hex(32))\""
        )
    return bytes.fromhex(hex_key)


def encrypt_api_key(plaintext: str) -> bytes:
    """Encrypt a plaintext API key string. Returns nonce + ciphertext bytes."""
    key    = _load_key()
    aesgcm = AESGCM(key)
    nonce  = secrets.token_bytes(_NONCE_SIZE)
    ct     = aesgcm.encrypt(nonce, plaintext.encode(), None)
    return nonce + ct                   # prepend nonce so we can decrypt later


def decrypt_api_key(blob: bytes) -> str:
    """Decrypt bytes produced by encrypt_api_key. Returns plaintext string."""
    key    = _load_key()
    aesgcm = AESGCM(key)
    nonce  = blob[:_NONCE_SIZE]
    ct     = blob[_NONCE_SIZE:]
    return aesgcm.decrypt(nonce, ct, None).decode()