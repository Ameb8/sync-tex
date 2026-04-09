"""
JWT bearer token verification.

assistant-service does NOT issue tokens — it only verifies them.
Tokens are issued by users-service and signed with a shared secret
(or RS256 public key if you switch to asymmetric signing).

Required env vars:
    JWT_SECRET      shared HMAC secret (HS256), OR
    JWT_PUBLIC_KEY  PEM-encoded RS256 public key

The sub claim is used as the user_id throughout assistant-service.
"""

import os
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt

_bearer = HTTPBearer()

_SECRET    = os.getenv("JWT_SECRET", "")
_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
_AUDIENCE  = os.getenv("JWT_AUDIENCE", "")


def _decode(token: str) -> dict:
    options = {}
    kwargs: dict = {"algorithms": [_ALGORITHM]}

    if _ALGORITHM.startswith("RS"):
        public_key = os.getenv("JWT_PUBLIC_KEY", "")
        if not public_key:
            raise RuntimeError("JWT_PUBLIC_KEY must be set for RS256 tokens")
        kwargs["key"] = public_key
    else:
        if not _SECRET:
            raise RuntimeError("JWT_SECRET must be set")
        kwargs["key"] = _SECRET

    if _AUDIENCE:
        kwargs["audience"] = _AUDIENCE
    else:
        options["verify_aud"] = False

    kwargs["options"] = options
    return jwt.decode(token, **kwargs)


def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> str:
    """
    FastAPI dependency — validates the Bearer token and returns the user_id (sub claim).

    Usage:
        @app.get("/keys")
        def list_keys(user_id: str = Depends(get_current_user_id)):
            ...
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = _decode(credentials.credentials)
        user_id: str = payload.get("sub", "") or payload.get("user_id", "")
        if not user_id:
            raise credentials_exception
        return user_id
    except JWTError:
        raise credentials_exception