import time
from collections.abc import Mapping
from typing import Any

import jwt


def mint_token(
    user_id: int,
    email: str,
    secret: str,
    expires_in: int = 3600,
    extra_claims: Mapping[str, Any] | None = None,
) -> str:
    now = int(time.time())
    payload: dict[str, Any] = {
        "user_id": user_id,
        "email": email,
        "exp": now + expires_in,
        **(extra_claims or {}),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def auth_headers_for_claims(
    claims: Mapping[str, int | str],
    secret: str,
    expires_in: int = 3600,
) -> dict[str, str]:
    token = mint_token(
        user_id=int(claims["user_id"]),
        email=str(claims["email"]),
        secret=secret,
        expires_in=expires_in,
    )
    return {"Authorization": f"Bearer {token}"}
