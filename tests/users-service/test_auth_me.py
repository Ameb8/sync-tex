# tests/users-service/test_auth_me.py
# Route group: Current User
# Routes covered: GET /auth/me

import time

import jwt
import requests

from helpers.auth import mint_token


JWT_SECRET = "test-users-secret-key-for-integration-tests"


def _token_with_sub_but_no_user_id(user_id, email):
    now = int(time.time())
    return jwt.encode(
        {"sub": str(user_id), "email": email, "exp": now + 3600},
        JWT_SECRET,
        algorithm="HS256",
    )


def _assert_current_user_shape(body):
    assert "id" in body
    assert "email" in body
    assert "name" in body
    assert "created_at" in body
    assert "password" not in body
    assert "oauth_provider" not in body
    assert "oauth_id" not in body


# -- GET /auth/me ------------------------------------------------------------

def test_get_auth_me_happy_path_with_bearer_token(base_url, registered_user):
    response = requests.get(
        f"{base_url}/auth/me",
        headers=registered_user.headers,
        timeout=5,
    )

    assert response.status_code == 200
    _assert_current_user_shape(response.json())


def test_get_auth_me_happy_path_with_raw_token(base_url, registered_user):
    response = requests.get(
        f"{base_url}/auth/me",
        headers={"Authorization": registered_user.token},
        timeout=5,
    )

    assert response.status_code == 200
    _assert_current_user_shape(response.json())


def test_get_auth_me_missing_authorization(base_url):
    response = requests.get(f"{base_url}/auth/me", timeout=5)

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing authorization header"


def test_get_auth_me_malformed_or_expired_token(base_url, registered_user):
    token = mint_token(
        user_id=registered_user.user_id,
        email=registered_user.email,
        secret=JWT_SECRET,
        expires_in=-1,
    )

    response = requests.get(
        f"{base_url}/auth/me",
        headers={"Authorization": f"Bearer {token}"},
        timeout=5,
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or expired token"


def test_get_auth_me_user_no_longer_exists(base_url):
    token = mint_token(
        user_id=999999999,
        email="missing@users.sync-tex.dev",
        secret=JWT_SECRET,
    )

    response = requests.get(
        f"{base_url}/auth/me",
        headers={"Authorization": f"Bearer {token}"},
        timeout=5,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "User not found"


def test_get_auth_me_missing_user_id_claim(base_url, registered_user):
    token = _token_with_sub_but_no_user_id(
        registered_user.user_id,
        registered_user.email,
    )

    response = requests.get(
        f"{base_url}/auth/me",
        headers={"Authorization": f"Bearer {token}"},
        timeout=5,
    )

    assert response.status_code == 500


# -- Coverage Gaps -----------------------------------------------------------

# Coverage Gaps: none
