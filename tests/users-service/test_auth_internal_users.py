# tests/users-service/test_auth_internal_users.py
# Route group: Internal User Lookup
# Routes covered: GET /auth/internal/users

import pytest
import requests


MISSING_USER_ID = 999999999
SECOND_MISSING_USER_ID = 999999998


class MissingUserIdsValidationEncodingBug(AssertionError):
    pass


def _internal_headers(internal_api_key):
    return {"X-Api-Key": internal_api_key}


# -- GET /auth/internal/users ------------------------------------------------

def test_get_auth_internal_users_happy_path_mixed_found_and_missing(
    base_url,
    registered_user,
    internal_api_key,
):
    response = requests.get(
        f"{base_url}/auth/internal/users",
        params=[
            ("user_ids", str(registered_user.user_id)),
            ("user_ids", str(MISSING_USER_ID)),
        ],
        headers=_internal_headers(internal_api_key),
        timeout=5,
    )

    assert response.status_code == 200
    body = response.json()
    users_by_id = {user["id"]: user for user in body["users"]}
    found_id = str(registered_user.user_id)
    missing_id = str(MISSING_USER_ID)
    assert found_id in users_by_id
    assert users_by_id[found_id]["id"] == found_id
    assert missing_id in body["not_found"]


def test_get_auth_internal_users_all_requested_users_missing(
    base_url,
    internal_api_key,
):
    missing_ids = [str(SECOND_MISSING_USER_ID), str(MISSING_USER_ID)]

    response = requests.get(
        f"{base_url}/auth/internal/users",
        params=[("user_ids", user_id) for user_id in missing_ids],
        headers=_internal_headers(internal_api_key),
        timeout=5,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["users"] == []
    assert set(body["not_found"]) == set(missing_ids)


def test_get_auth_internal_users_missing_api_key(base_url, registered_user):
    response = requests.get(
        f"{base_url}/auth/internal/users",
        params=[("user_ids", str(registered_user.user_id))],
        timeout=5,
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or missing API key"


def test_get_auth_internal_users_invalid_api_key(base_url, registered_user):
    response = requests.get(
        f"{base_url}/auth/internal/users",
        params=[("user_ids", str(registered_user.user_id))],
        headers={"X-Api-Key": "xxxx-users-internal-api-key"},
        timeout=5,
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or missing API key"


@pytest.mark.xfail(
    raises=MissingUserIdsValidationEncodingBug,
    reason=(
        "FastAPI detects missing required query user_ids, but the pinned "
        "FastAPI/Pydantic stack fails while JSON-encoding the resulting "
        "RequestValidationError because it contains PydanticUndefined."
    ),
    strict=True,
)
def test_get_auth_internal_users_missing_user_ids_query(base_url, internal_api_key):
    response = requests.get(
        f"{base_url}/auth/internal/users",
        headers=_internal_headers(internal_api_key),
        timeout=5,
    )

    # Contract: user_ids is declared as Query(...), so a request without the
    # query parameter should return FastAPI's normal 422 validation response.
    # Current behavior: validation is raised, but serializing the validation
    # error fails because the error includes PydanticUndefined, and the broad
    # exception path returns a 500 body with these encoder TypeErrors. Raise a
    # dedicated exception only for that exact known bug so unrelated failures
    # are not hidden by the xfail marker.
    if response.status_code == 500:
        detail = response.json().get("detail", "")
        if "PydanticUndefinedType" in detail and "vars() argument" in detail:
            raise MissingUserIdsValidationEncodingBug(detail)

    assert response.status_code == 422


def test_get_auth_internal_users_invalid_user_ids_value(base_url, internal_api_key):
    response = requests.get(
        f"{base_url}/auth/internal/users",
        params=[("user_ids", "abc")],
        headers=_internal_headers(internal_api_key),
        timeout=5,
    )

    assert response.status_code == 422


@pytest.mark.skip(reason="requires users_service_env_variant fixture without API key")
def test_get_auth_internal_users_api_key_not_configured(
    base_url,
    registered_user,
    internal_api_key,
):
    pass


# -- Coverage Gaps -----------------------------------------------------------

# Coverage Gaps:
# - GET /auth/internal/users: API key not configured skipped because the harness
#   has no users_service_env_variant fixture or compose/env variant without
#   USERS_INTERNAL_API_KEY.
