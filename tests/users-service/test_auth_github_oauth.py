# tests/users-service/test_auth_github_oauth.py
# Route group: GitHub OAuth
# Routes covered: GET /auth/github/login, GET /auth/github/callback

from urllib.parse import parse_qs, urlparse

import pytest
import requests

from helpers.db import db_connection


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


# -- GET /auth/github/login --------------------------------------------------

def test_get_auth_github_login_happy_path(base_url):
    response = requests.get(
        f"{base_url}/auth/github/login",
        allow_redirects=False,
        timeout=5,
    )

    assert response.status_code == 307
    location = response.headers["Location"]
    assert location.startswith("https://github.com/login/oauth/authorize")

    query = parse_qs(urlparse(location).query)
    assert query["client_id"] == ["test-github-client-id"]
    assert query["redirect_uri"] == ["http://localhost:8101/auth/github/callback"]
    assert query["scope"] == ["user:email"]
    assert query["state"][0]


# -- GET /auth/github/callback ----------------------------------------------

@pytest.mark.skip(
    reason="requires GitHub OAuth HTTPS interception for token and user endpoints"
)
def test_get_auth_github_callback_happy_path_new_user_with_email_from_user(
    base_url,
    database_url,
):
    pass


@pytest.mark.skip(
    reason="requires GitHub OAuth HTTPS interception for token, user, and emails endpoints"
)
def test_get_auth_github_callback_happy_path_email_from_user_emails(
    base_url,
    database_url,
):
    pass


@pytest.mark.skip(
    reason="requires GitHub OAuth HTTPS interception for token and user endpoints"
)
def test_get_auth_github_callback_existing_password_user_links_github(
    base_url,
    database_url,
    registered_user,
):
    pass


@pytest.mark.parametrize("missing_field", ["code", "state"])
def test_get_auth_github_callback_missing_required_query_parameter(
    base_url,
    database_url,
    missing_field,
):
    user_count_before = _count_users(database_url)
    params = {"code": "test-code", "state": "test-state"}
    params.pop(missing_field)

    response = requests.get(
        f"{base_url}/auth/github/callback",
        params=params,
        allow_redirects=False,
        timeout=5,
    )

    _assert_validation_error_for_query_field(response, missing_field)
    assert _count_users(database_url) == user_count_before


def test_get_auth_github_callback_invalid_state(base_url, database_url):
    user_count_before = _count_users(database_url)

    response = requests.get(
        f"{base_url}/auth/github/callback",
        params={"code": "test-code", "state": "state-not-created-by-login"},
        allow_redirects=False,
        timeout=5,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid state"
    assert _count_users(database_url) == user_count_before


@pytest.mark.skip(reason="requires GitHub OAuth HTTPS interception for token endpoint")
def test_get_auth_github_callback_token_exchange_non_200(base_url, database_url):
    pass


@pytest.mark.skip(reason="requires GitHub OAuth HTTPS interception for token endpoint")
def test_get_auth_github_callback_token_exchange_json_error(base_url, database_url):
    pass


@pytest.mark.skip(reason="requires GitHub OAuth HTTPS interception for user endpoint")
def test_get_auth_github_callback_github_user_fetch_non_200(base_url, database_url):
    pass


@pytest.mark.skip(
    reason="requires GitHub OAuth HTTPS interception for token, user, and emails endpoints"
)
def test_get_auth_github_callback_github_email_unavailable(base_url, database_url):
    pass


@pytest.mark.skip(reason="requires users_service_env_variant fixture for missing OAuth env")
def test_get_auth_github_callback_missing_oauth_configuration(base_url, database_url):
    pass


# -- Coverage Gaps -----------------------------------------------------------

# Coverage Gaps:
# - GET /auth/github/login: Happy path cannot assert the in-memory oauth_states
#   insertion directly because the harness exposes no state inspection helper.
# - GET /auth/github/callback: Happy path, new user with email from /user skipped
#   because the harness has no fake/stub API for the hardcoded GitHub HTTPS URLs.
# - GET /auth/github/callback: Happy path, email from /user/emails skipped
#   because the harness has no fake/stub API for the hardcoded GitHub HTTPS URLs.
# - GET /auth/github/callback: Existing password user links GitHub skipped
#   because the harness has no fake/stub API for the hardcoded GitHub HTTPS URLs.
# - GET /auth/github/callback: Missing required query parameter cannot assert
#   absence of upstream calls because the harness has no upstream call recorder.
# - GET /auth/github/callback: Invalid state cannot assert absence of upstream
#   calls because the harness has no upstream call recorder.
# - GET /auth/github/callback: Token exchange non-200 skipped because the
#   harness has no fake/stub API for the hardcoded GitHub HTTPS URLs.
# - GET /auth/github/callback: Token exchange JSON error skipped because the
#   harness has no fake/stub API for the hardcoded GitHub HTTPS URLs.
# - GET /auth/github/callback: GitHub user fetch non-200 skipped because the
#   harness has no fake/stub API for the hardcoded GitHub HTTPS URLs.
# - GET /auth/github/callback: GitHub email unavailable skipped because the
#   harness has no fake/stub API for the hardcoded GitHub HTTPS URLs.
# - GET /auth/github/callback: Missing OAuth configuration skipped because the
#   harness has no users_service_env_variant fixture or compose/env variant.
