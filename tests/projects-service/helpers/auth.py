"""
helpers/auth.py — mint JWTs that the projects-service will accept.

The service validates using JWT_SECRET (HS256). We replicate that here
so tests can produce tokens for arbitrary user IDs without a real auth service.
"""

import time
import jwt  # PyJWT


def mint_token(
    user_id: str,
    secret: str,
    expires_in: int = 3600,
    extra_claims: dict | None = None,
) -> str:
    """
    Mint a signed JWT for the given user_id.

    Args:
        user_id:     User ID
        secret:      Must match JWT_SECRET env var in the service.
        expires_in:  Token lifetime in seconds (default 1 hour).
        extra_claims: Any additional claims to merge into the payload.

    Returns:
        A signed JWT string ready to use as a Bearer token.
    """
    now = int(time.time())
    payload = {
        "user_id": user_id,
        "exp": now + expires_in,
        **(extra_claims or {}),
    }
    return jwt.encode(payload, secret, algorithm="HS256")