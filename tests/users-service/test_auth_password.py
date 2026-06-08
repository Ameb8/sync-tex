# tests/users-service/test_auth_password.py
# Route group: Password Authentication
# Routes covered: POST /auth/register, POST /auth/login

import uuid

import jwt
import pytest
import requests

from helpers.db import db_connection, fetch_user_by_email


JWT_SECRET = "test-users-secret-key-for-integration-tests"


def _assert_validation_error_for_field(response, field):
    assert response.status_code == 422
    errors = response.json()["detail"]
    assert any(error.get("loc") == ["body", field] for error in errors), errors


def _fetch_user_auth_fields(database_url, email):
    with db_connection(database_url) as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, email, password, name, oauth_provider, oauth_id
                FROM users
                WHERE email = %s
                """,
                (email,),
            )
            row = cursor.fetchone()

    if row is None:
        return None

    return {
        "id": row[0],
        "email": row[1],
        "password": row[2],
        "name": row[3],
        "oauth_provider": row[4],
        "oauth_id": row[5],
    }


def _count_users_by_email(database_url, email):
    with db_connection(database_url) as conn:
        with conn.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM users WHERE email = %s", (email,))
            row = cursor.fetchone()
    return row[0]


def _insert_oauth_user(database_url, email):
    with db_connection(database_url) as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO users (email, password, name, oauth_provider, oauth_id)
                VALUES (%s, NULL, %s, %s, %s)
                RETURNING id
                """,
                (email, "OAuth User", "github", f"github-{uuid.uuid4().hex}"),
            )
            user_id = cursor.fetchone()[0]
        conn.commit()
    return user_id


# -- POST /auth/register -----------------------------------------------------

def test_post_auth_register_happy_path(base_url, database_url, unique_email):
    password = f"Test-password-{uuid.uuid4().hex}"
    response = requests.post(
        f"{base_url}/auth/register",
        json={"email": unique_email, "password": password, "name": "Test User"},
        timeout=5,
    )

    assert response.status_code == 200
    body = response.json()
    assert "token" in body
    assert isinstance(body["user_id"], int)
    assert body["email"] == unique_email

    claims = jwt.decode(body["token"], JWT_SECRET, algorithms=["HS256"])
    assert claims["user_id"] == body["user_id"]
    assert claims["email"] == unique_email

    row = _fetch_user_auth_fields(database_url, unique_email)
    assert row is not None
    assert row["email"] == unique_email
    assert row["name"] == "Test User"
    assert row["password"] is not None
    assert row["oauth_provider"] is None
    assert row["oauth_id"] is None


@pytest.mark.parametrize("missing_field", ["email", "password"])
def test_post_auth_register_missing_required_field(
    base_url,
    database_url,
    unique_email,
    missing_field,
):
    body = {
        "email": unique_email,
        "password": f"Test-password-{uuid.uuid4().hex}",
        "name": "Test User",
    }
    body.pop(missing_field)

    response = requests.post(f"{base_url}/auth/register", json=body, timeout=5)

    _assert_validation_error_for_field(response, missing_field)
    assert fetch_user_by_email(database_url, unique_email) is None


def test_post_auth_register_invalid_email(base_url, database_url):
    email = "not-an-email"

    response = requests.post(
        f"{base_url}/auth/register",
        json={
            "email": email,
            "password": f"Test-password-{uuid.uuid4().hex}",
            "name": "Test User",
        },
        timeout=5,
    )

    _assert_validation_error_for_field(response, "email")
    assert fetch_user_by_email(database_url, email) is None


def test_post_auth_register_duplicate_email(base_url, database_url, unique_email):
    body = {
        "email": unique_email,
        "password": f"Test-password-{uuid.uuid4().hex}",
        "name": "Test User",
    }

    first_response = requests.post(f"{base_url}/auth/register", json=body, timeout=5)
    assert first_response.status_code == 200

    duplicate_response = requests.post(f"{base_url}/auth/register", json=body, timeout=5)

    assert duplicate_response.status_code == 409
    assert duplicate_response.json()["detail"] == "Email already exists"
    assert _count_users_by_email(database_url, unique_email) == 1


# -- POST /auth/login --------------------------------------------------------

def test_post_auth_login_happy_path(base_url, registered_user):
    response = requests.post(
        f"{base_url}/auth/login",
        json={"email": registered_user.email, "password": registered_user.password},
        timeout=5,
    )

    assert response.status_code == 200
    body = response.json()
    assert "token" in body
    assert body["user_id"] == registered_user.user_id
    assert body["email"] == registered_user.email

    claims = jwt.decode(body["token"], JWT_SECRET, algorithms=["HS256"])
    assert claims["user_id"] == registered_user.user_id
    assert claims["email"] == registered_user.email


@pytest.mark.parametrize("missing_field", ["email", "password"])
def test_post_auth_login_missing_required_field(base_url, unique_email, missing_field):
    body = {"email": unique_email, "password": f"Test-password-{uuid.uuid4().hex}"}
    body.pop(missing_field)

    response = requests.post(f"{base_url}/auth/login", json=body, timeout=5)

    _assert_validation_error_for_field(response, missing_field)


def test_post_auth_login_invalid_email(base_url):
    response = requests.post(
        f"{base_url}/auth/login",
        json={"email": "not-an-email", "password": f"Test-password-{uuid.uuid4().hex}"},
        timeout=5,
    )

    _assert_validation_error_for_field(response, "email")


def test_post_auth_login_wrong_password(base_url, registered_user):
    response = requests.post(
        f"{base_url}/auth/login",
        json={"email": registered_user.email, "password": "incorrect-password"},
        timeout=5,
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"


def test_post_auth_login_unknown_email(base_url, unique_email):
    response = requests.post(
        f"{base_url}/auth/login",
        json={"email": unique_email, "password": f"Test-password-{uuid.uuid4().hex}"},
        timeout=5,
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"


def test_post_auth_login_oauth_only_user_cannot_password_login(
    base_url,
    database_url,
    unique_email,
):
    _insert_oauth_user(database_url, unique_email)

    response = requests.post(
        f"{base_url}/auth/login",
        json={"email": unique_email, "password": f"Test-password-{uuid.uuid4().hex}"},
        timeout=5,
    )

    assert response.status_code == 401


# -- Coverage Gaps -----------------------------------------------------------

# Coverage Gaps: none
