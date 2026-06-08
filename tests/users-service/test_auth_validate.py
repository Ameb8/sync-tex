# tests/users-service/test_auth_validate.py
# Route group: Token Validation
# Routes covered: GET /auth/validate

import time

import jwt
import requests

from helpers.auth import mint_token


JWT_SECRET = "test-users-secret-key-for-integration-tests"


def _token_with_sub_but_no_user_id(email):
    now = int(time.time())
    return jwt.encode(
        {"sub": "claim-mismatch-user", "email": email, "exp": now + 3600},
        JWT_SECRET,
        algorithm="HS256",
    )


# -- GET /auth/validate ------------------------------------------------------

def test_get_auth_validate_happy_path_with_bearer_token(base_url, registered_user):
    response = requests.get(
        f"{base_url}/auth/validate",
        headers=registered_user.headers,
        timeout=5,
    )

    assert response.status_code == 200
    assert response.json() == {
        "user_id": registered_user.user_id,
        "email": registered_user.email,
    }


def test_get_auth_validate_happy_path_with_raw_token(base_url, registered_user):
    response = requests.get(
        f"{base_url}/auth/validate",
        headers={"Authorization": registered_user.token},
        timeout=5,
    )

    assert response.status_code == 200
    assert response.json() == {
        "user_id": registered_user.user_id,
        "email": registered_user.email,
    }


def test_get_auth_validate_missing_authorization(base_url):
    response = requests.get(f"{base_url}/auth/validate", timeout=5)

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing authorization header"


def test_get_auth_validate_malformed_token(base_url):
    response = requests.get(
        f"{base_url}/auth/validate",
        headers={"Authorization": "Bearer not-a-jwt"},
        timeout=5,
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or expired token"


def test_get_auth_validate_expired_token(base_url, registered_user):
    token = mint_token(
        user_id=registered_user.user_id,
        email=registered_user.email,
        secret=JWT_SECRET,
        expires_in=-1,
    )

    response = requests.get(
        f"{base_url}/auth/validate",
        headers={"Authorization": f"Bearer {token}"},
        timeout=5,
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or expired token"


def test_get_auth_validate_missing_user_id_claim(base_url, registered_user):
    token = _token_with_sub_but_no_user_id(registered_user.email)

    response = requests.get(
        f"{base_url}/auth/validate",
        headers={"Authorization": f"Bearer {token}"},
        timeout=5,
    )

    assert response.status_code == 500


# -- Coverage Gaps -----------------------------------------------------------

# Coverage Gaps: none
