import os
import subprocess
import time
import uuid
from collections.abc import Iterator
from dataclasses import dataclass

import pytest
import requests


SERVICE_NAME = "users-service"
COMPOSE_FILE = os.path.join(os.path.dirname(__file__), "docker-compose.test.yml")
COMPOSE_PROJECT_NAME = f"sync-tex-users-service-test-{uuid.uuid4().hex[:8]}"

SERVICE_URL = "http://localhost:8101"
HEALTH_URL = f"{SERVICE_URL}/health"
DATABASE_URL = "postgresql://testuser:testpassword@localhost:5501/users_test"
JWT_SECRET = "test-users-secret-key-for-integration-tests"
USERS_INTERNAL_API_KEY = "test-users-internal-api-key"
STACK_STARTUP_TIMEOUT = 120


@dataclass(frozen=True)
class RegisteredUser:
    user_id: int
    email: str
    password: str
    token: str
    headers: dict[str, str]


def _compose(*args: str) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "COMPOSE_PROJECT_NAME": COMPOSE_PROJECT_NAME}
    result = subprocess.run(
        ["docker", "compose", "-f", COMPOSE_FILE, *args],
        capture_output=True,
        text=True,
        env=env,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "docker compose failed: "
            f"{' '.join(args)}\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
    return result


def _wait_for_health(url: str, timeout: int = STACK_STARTUP_TIMEOUT) -> None:
    deadline = time.time() + timeout
    last_error: Exception | None = None
    last_status: int | None = None

    while time.time() < deadline:
        try:
            response = requests.get(url, timeout=3)
            last_status = response.status_code
            if response.status_code == 200:
                return
        except requests.RequestException as exc:
            last_error = exc
        time.sleep(2)

    raise RuntimeError(
        f"{SERVICE_NAME} at {url} did not become healthy within {timeout}s. "
        f"Last status: {last_status}; last error: {last_error}"
    )


@pytest.fixture(scope="session", autouse=True)
def docker_stack() -> Iterator[None]:
    _compose("up", "--build", "--detach")
    try:
        _wait_for_health(HEALTH_URL)
        yield
    finally:
        _compose("down", "--volumes", "--remove-orphans")


@pytest.fixture(scope="session")
def base_url() -> str:
    return SERVICE_URL


@pytest.fixture(scope="session")
def database_url() -> str:
    return DATABASE_URL


@pytest.fixture(scope="session")
def internal_api_key() -> str:
    return USERS_INTERNAL_API_KEY


@pytest.fixture
def unique_email() -> str:
    return f"user-{uuid.uuid4().hex}@example.test"


@pytest.fixture
def unique_user_claims(unique_email: str) -> dict[str, int | str]:
    return {"user_id": int(time.time() * 1000), "email": unique_email}


@pytest.fixture
def auth_headers(unique_user_claims: dict[str, int | str]) -> dict[str, str]:
    from helpers.auth import auth_headers_for_claims

    return auth_headers_for_claims(unique_user_claims, secret=JWT_SECRET)


@pytest.fixture
def registered_user(base_url: str, unique_email: str) -> RegisteredUser:
    password = f"Test-password-{uuid.uuid4().hex}"
    response = requests.post(
        f"{base_url}/auth/register",
        json={"email": unique_email, "password": password, "name": "Test User"},
        timeout=5,
    )
    assert response.status_code == 200, (
        f"registered_user fixture failed: {response.status_code} {response.text}"
    )

    body = response.json()
    token = body["token"]
    return RegisteredUser(
        user_id=body["user_id"],
        email=body["email"],
        password=password,
        token=token,
        headers={"Authorization": f"Bearer {token}"},
    )
