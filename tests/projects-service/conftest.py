"""
conftest.py — session-scoped Docker stack management.

Brings up docker-compose.test.yml before the session, waits for the
projects-service health endpoint, then tears everything down afterward.

Each test gets isolation by using a unique `sub` (user ID) in its JWT,
so tests never step on each other's data without needing DB wipes.
"""

import os
import subprocess
import time
import uuid

import pytest
import requests

# ── Config ────────────────────────────────────────────────────────────────────

COMPOSE_FILE = os.path.join(os.path.dirname(__file__), "docker-compose.test.yml")
COMPOSE_PROJECT_NAME = f"sync-tex-projects-service-test-{uuid.uuid4().hex[:8]}"
SERVICE_URL = "http://localhost:8099"
HEALTH_URL = f"{SERVICE_URL}/health"
JWT_SECRET = "test-jwt-secret-for-integration-tests"  # must match compose env
MINIO_BUCKETS = ("uploads", "snapshot", "text")

# How long to wait for the stack to become healthy (seconds)
STACK_STARTUP_TIMEOUT = 120


# ── Stack lifecycle ────────────────────────────────────────────────────────────

def _compose(*args):
    """Run a docker compose command against the test compose file."""
    env = {**os.environ, "COMPOSE_PROJECT_NAME": COMPOSE_PROJECT_NAME}
    return subprocess.run(
        ["docker", "compose", "-f", COMPOSE_FILE, *args],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )


def _wait_healthy(url: str, timeout: int = STACK_STARTUP_TIMEOUT):
    """Poll url until 200 or timeout, then raise."""
    deadline = time.time() + timeout
    last_err = None
    while time.time() < deadline:
        try:
            r = requests.get(url, timeout=3)
            if r.status_code == 200:
                return
        except requests.RequestException as e:
            last_err = e
        time.sleep(2)
    raise RuntimeError(
        f"Service at {url} never became healthy within {timeout}s. "
        f"Last error: {last_err}"
    )


def _ensure_minio_buckets():
    """Create object-storage buckets required by projects-service handlers."""
    from helpers.minio import ensure_bucket

    for bucket in MINIO_BUCKETS:
        ensure_bucket(bucket)


@pytest.fixture(scope="session", autouse=True)
def docker_stack():
    """
    Session fixture: spin up the full test stack, yield, tear it down.

    autouse=True means every test in the session gets this automatically.
    """
    print("\n[conftest] Building and starting test stack...")
    try:
        _compose("up", "--build", "--detach")
    except subprocess.CalledProcessError as e:
        raise

    try:
        print(f"[conftest] Waiting for {HEALTH_URL} ...")
        _wait_healthy(HEALTH_URL)
        _ensure_minio_buckets()
        print("[conftest] Stack is healthy — running tests.")
        yield
    finally:
        print("\n[conftest] Tearing down test stack...")
        try:
            _compose("down", "--volumes", "--remove-orphans")
        except subprocess.CalledProcessError as e:
            print(f"[conftest] Warning: tear-down error: {e.stderr}")


# ── Shared fixtures ────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def base_url():
    return SERVICE_URL


@pytest.fixture
def unique_user():
    """
    Returns a fresh (user_id, auth_headers) pair per test.

    Because each call produces a new UUID sub, tests are fully isolated
    without any DB cleanup — each user sees only their own projects.
    """
    from helpers.auth import mint_token
    user_id = str(uuid.uuid4())
    token = mint_token(user_id, secret=JWT_SECRET)
    headers = {"Authorization": f"Bearer {token}"}
    return user_id, headers


@pytest.fixture
def second_user():
    """A second distinct user, useful for collaboration tests."""
    from helpers.auth import mint_token
    user_id = str(uuid.uuid4())
    token = mint_token(user_id, secret=JWT_SECRET)
    headers = {"Authorization": f"Bearer {token}"}
    return user_id, headers


@pytest.fixture
def project(base_url, unique_user):
    """
    Creates a project and returns its data dict.
    Convenience fixture so tests that need an existing project don't repeat setup.
    """
    _, headers = unique_user
    r = requests.post(
        f"{base_url}/projects/v1/projects",
        json={"name": f"fixture-project-{uuid.uuid4().hex[:8]}"},
        headers=headers,
    )
    assert r.status_code == 201, f"project fixture failed: {r.status_code} {r.text}"
    return r.json(), headers  # (project_data, owner_headers)
