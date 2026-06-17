# tests/users-service/test_auth_google_oauth.py
# Route group: Google OAuth
# Routes covered: GET /auth/google/login, GET /auth/google/callback

from urllib.parse import parse_qs, urlparse

import pytest
import requests

from helpers.db import db_connection


FRONTEND_URL = "http://localhost:3000"


def _count_users(database_url):
    with db_connection(database_url) as conn:
        with conn.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM users")
            row = cursor.fetchone()
    return row[0]


def _assert_validation_error_for_query_field(response, field):
    assert response.status_code == 422
    errors = response.json()["detail"]
    assert any(error.get("loc") == ["query", field] for error in errors), errors


def _login_state(base_url):
    response = requests.get(
        f"{base_url}/auth/google/login",
        allow_redirects=False,
        timeout=5,
    )
    assert response.status_code == 307
    query = parse_qs(urlparse(response.headers["Location"]).query)
    return query["state"][0]


# -- GET /auth/google/login --------------------------------------------------

def test_get_auth_google_login_happy_path(base_url):
    response = requests.get(
        f"{base_url}/auth/google/login",
        allow_redirects=False,
        timeout=5,
    )

    assert response.status_code == 307
    location = response.headers["Location"]
    assert location.startswith("https://accounts.google.com/o/oauth2/v2/auth")

    query = parse_qs(urlparse(location).query)
    assert query["client_id"] == ["test-google-client-id"]
    assert query["redirect_uri"] == ["http://localhost:8101/auth/google/callback"]
    assert query["response_type"] == ["code"]

    scopes = set(query["scope"][0].split())
    assert {"openid", "email", "profile"}.issubset(scopes)
    assert query["state"][0]


# -- GET /auth/google/callback ----------------------------------------------

@pytest.mark.parametrize("missing_field", ["code", "state"])
def test_get_auth_google_callback_missing_required_query_parameter(
    base_url,
    database_url,
    missing_field,
):
    user_count_before = _count_users(database_url)
    params = {"code": "test-code", "state": "test-state"}
    params.pop(missing_field)

    response = requests.get(
        f"{base_url}/auth/google/callback",
        params=params,
        allow_redirects=False,
        timeout=5,
    )

    _assert_validation_error_for_query_field(response, missing_field)
    assert _count_users(database_url) == user_count_before


def test_get_auth_google_callback_invalid_state(base_url, database_url):
    user_count_before = _count_users(database_url)

    response = requests.get(
        f"{base_url}/auth/google/callback",
        params={"code": "test-code", "state": "state-not-created-by-login"},
        allow_redirects=False,
        timeout=5,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid state"
    assert _count_users(database_url) == user_count_before


def test_get_auth_google_callback_provider_error_redirects_to_frontend(
    base_url,
    database_url,
):
    user_count_before = _count_users(database_url)
    state = _login_state(base_url)

    response = requests.get(
        f"{base_url}/auth/google/callback",
        params={
            "state": state,
            "error": "access_denied",
            "error_description": "Access denied by user",
        },
        allow_redirects=False,
        timeout=5,
    )

    assert response.status_code == 307
    location = response.headers["Location"]
    assert location.startswith(f"{FRONTEND_URL}/oauth/callback")
    assert parse_qs(urlparse(location).query)["error"] == ["Access denied by user"]
    assert _count_users(database_url) == user_count_before


def test_get_auth_google_callback_consumes_state_after_provider_error(base_url):
    state = _login_state(base_url)

    first_response = requests.get(
        f"{base_url}/auth/google/callback",
        params={"state": state, "error": "access_denied"},
        allow_redirects=False,
        timeout=5,
    )
    assert first_response.status_code == 307

    second_response = requests.get(
        f"{base_url}/auth/google/callback",
        params={"state": state, "error": "access_denied"},
        allow_redirects=False,
        timeout=5,
    )

    assert second_response.status_code == 400
    assert second_response.json()["detail"] == "Invalid state"


@pytest.mark.skip(reason="requires fake Google token endpoint")
def test_get_auth_google_callback_token_exchange_non_200(base_url, database_url):
    pass


@pytest.mark.skip(reason="requires injectable Google ID token validation")
def test_get_auth_google_callback_invalid_id_token(base_url, database_url):
    pass


@pytest.mark.skip(reason="requires fake Google token endpoint and profile validation")
def test_get_auth_google_callback_existing_password_user_links_google(
    base_url,
    database_url,
    registered_user,
):
    pass


@pytest.mark.skip(reason="requires fake Google token endpoint and profile validation")
def test_get_auth_google_callback_existing_github_user_links_google_by_verified_email(
    base_url,
    database_url,
):
    pass


@pytest.mark.skip(reason="requires fake Google token endpoint and profile validation")
def test_get_auth_google_callback_same_user_cannot_link_two_google_identities(
    base_url,
    database_url,
):
    pass


# -- Coverage Gaps -----------------------------------------------------------

# Coverage Gaps:
# - GET /auth/google/login: Happy path cannot assert the database oauth_states
#   insertion directly because the harness exposes no state inspection helper.
# - GET /auth/google/callback: Token exchange non-200 skipped because the
#   harness has no fake/stub API for Google token endpoint responses.
# - GET /auth/google/callback: Invalid ID token skipped because the integration
#   harness does not provide injectable Google ID token validation.
# - GET /auth/google/callback: Existing password user links Google skipped
#   because the harness has no fake token exchange or ID token validation path.
# - GET /auth/google/callback: Existing GitHub user links Google by verified
#   email skipped because the harness has no fake Google profile validation.
# - GET /auth/google/callback: Duplicate Google identity conflict skipped
#   because the harness has no fake Google profile validation.
