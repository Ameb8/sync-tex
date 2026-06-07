---
name: setup-service-integration-tests
description: Set up service-specific black-box pytest integration test harnesses for SyncTeX backend services. Use when Codex needs to create or refine service test directories, Docker Compose test stacks, pytest fixtures, auth/storage/database helpers, and service-agnostic integration-test scaffolding without writing service-specific behavioral test cases or CI workflows.
---

# Setup Service Integration Tests

## Overview

Create a professional, service-specific black-box integration test harness for SyncTeX backend services. The harness should run the service under test in Docker Compose with real owned infrastructure, expose only test endpoints needed by pytest, and leave behavioral test cases for a separate task.

## Operating Rules

- Do not write service-specific behavioral tests unless the user explicitly asks. Set up structure, fixtures, helpers, and optional harness-only validation.
- Do not add or mention CI workflow setup.
- Prefer production Dockerfiles for the service under test unless the repo proves they cannot run in the test stack.
- Keep each service stack minimal: include the service under test plus owned persistence/infrastructure; stub other SyncTeX services unless the requested setup explicitly requires full-stack behavior.
- Keep tests black-box: pytest should call public HTTP endpoints from outside the service container instead of importing service internals.
- Preserve existing repo conventions and AGENTS.md guidance. In SyncTeX, pay close attention to JWT claim names and types across languages.

## Workflow

1. Inspect the service directory, Dockerfiles, config loading, health/readiness endpoints, migrations, and cross-service dependencies.
2. Create or update `tests/<service>/` with a service-owned test harness.
3. Add `docker-compose.test.yml` that builds/runs the service and its owned test dependencies.
4. Add `conftest.py` that manages stack lifecycle, waits for readiness, exposes clients/base URLs, and creates isolated identities/resources.
5. Add helper modules for repo-wide concerns such as JWT minting, MinIO/S3 inspection, Postgres inspection, fake upstream services, and random IDs.
6. Add `pytest.ini` and `requirements.txt` with only dependencies needed by the harness.
7. Add one generic harness-validation health test when the service exposes a stable health/readiness endpoint.
8. Validate with Docker Compose config rendering and pytest execution or collection.

## Directory Shape

Use this shape unless the repo already has a stronger convention:

```text
tests/<service>/
  conftest.py
  docker-compose.test.yml
  pytest.ini
  requirements.txt
  helpers/
    __init__.py
```

Add service-specific helper files only when needed, for example:

```text
helpers/
  auth.py
  db.py
  minio.py
  fake_upstream.py
```

Do not add README-style documentation to the harness unless the repo already documents tests that way.

## Compose Stack Requirements

`docker-compose.test.yml` should be deterministic, hermetic, and easy to tear down.

Required properties:

- Use test-only database names, credentials, secrets, buckets, and API keys.
- Include real migrations for services with persistent schema.
- Use health checks for infrastructure containers.
- Expose the service under test to localhost on a test port.
- Put all services on a dedicated test network.
- Avoid `container_name`; let Compose namespace containers through project names.
- Avoid persistent named volumes unless there is a reason. Prefer anonymous volumes or explicit teardown with `down --volumes --remove-orphans`.
- Set dummy values for unused dependencies so startup succeeds without pulling in the entire SyncTeX graph.
- Use fake/stub containers for required upstream services that are not under test.
- Make internal Docker hostnames match service config, then expose external hostnames only where clients need them.

Preferred service naming:

```yaml
services:
  <service>-test:
  postgres-test:
  minio-test:
  migrate-test:
  fake-<upstream>-test:
```

Use a unique Compose project name from pytest rather than hard-coded container names:

```python
COMPOSE_PROJECT_NAME = f"sync-tex-{SERVICE_NAME}-test-{uuid.uuid4().hex[:8]}"
```

Pass it to Compose:

```python
env = {**os.environ, "COMPOSE_PROJECT_NAME": COMPOSE_PROJECT_NAME}
subprocess.run(["docker", "compose", "-f", COMPOSE_FILE, *args], env=env, check=True)
```

## Pytest Lifecycle

Use a session-scoped autouse fixture to own the stack lifecycle:

```python
@pytest.fixture(scope="session", autouse=True)
def docker_stack():
    compose("up", "--build", "--detach")
    try:
        wait_for_health(HEALTH_URL)
        yield
    finally:
        compose("down", "--volumes", "--remove-orphans")
```

Implement readiness polling with a deadline and last-error reporting. Do not rely only on `depends_on`; the service endpoint should be ready before tests run.

Expose simple fixtures:

```python
@pytest.fixture(scope="session")
def base_url():
    return SERVICE_URL

@pytest.fixture
def unique_id():
    return str(uuid.uuid4())
```

For authenticated services, add per-test identity fixtures that mint tokens with the exact claim shape accepted by the service under test:

```python
@pytest.fixture
def unique_user():
    user_id = str(uuid.uuid4())
    token = mint_token(user_id, secret=JWT_SECRET)
    return user_id, {"Authorization": f"Bearer {token}"}
```

Do not assume `sub`, `user_id`, numeric IDs, or string IDs. Inspect the service middleware/config and make the helper match reality.

## Dependency Harness Patterns

Use these patterns consistently across backend services:

- **Postgres**: run a service-specific Postgres container, use test credentials, wait on `pg_isready`, run real migrations before service startup, and tear down volumes.
- **MinIO/S3**: run MinIO when the service owns object-storage behavior. Configure internal endpoint for containers and external endpoint for pytest/client-visible presigned URLs.
- **Other SyncTeX services**: use fake HTTP/gRPC servers unless this harness is intentionally testing a real cross-service integration.
- **External providers**: never call real OAuth, LLM, email, payment, or third-party APIs in service integration setup. Provide fake endpoints, dummy keys, or stubs.

## Helper Standards

Helpers should be thin and test-facing. They should not become a second implementation of the service.

Recommended helpers:

- `helpers/auth.py`: token minting and auth header construction.
- `helpers/db.py`: optional database inspection for side-effect assertions.
- `helpers/minio.py`: object existence/listing helpers.
- `helpers/http.py`: small request helpers only when they reduce boilerplate without hiding behavior.
- `helpers/fakes.py`: fake upstream-service response setup when needed.

Keep secrets and endpoints in one place, matching `docker-compose.test.yml`.

## Pytest Config

Use a local `pytest.ini`:

```ini
[pytest]
timeout = 60
addopts = -v --tb=short
timeout_func_only = true
```

Use `requirements.txt` for harness dependencies. Start minimal:

```text
pytest>=8.0
requests>=2.31
pytest-timeout>=2.3
```

Add only what the harness uses, such as `PyJWT`, `boto3`, or `psycopg`.

## Harness Validation Test

If the service exposes a stable health/readiness endpoint, add exactly one generic test that proves the test harness works end-to-end. Name it clearly, for example `test_health.py` or `test_harness.py`.

Example:

```python
import requests


def test_service_health(base_url):
    r = requests.get(f"{base_url}/health", timeout=5)
    assert r.status_code == 200
```

Keep this test limited to harness validation. Do not add domain-specific API assertions, persistence assertions, permission assertions, or service behavior coverage unless the user explicitly asks for test cases.

## Validation

After setup, run checks that validate the harness without adding service-specific behavior:

```bash
docker compose -f tests/<service>/docker-compose.test.yml config
python -m pytest -c tests/<service>/pytest.ini tests/<service>
```

If the service has no stable health/readiness endpoint yet, use `--collect-only` instead of full pytest execution and state that executable harness validation is blocked until such an endpoint exists.

Also verify cleanup works:

```bash
docker compose -f tests/<service>/docker-compose.test.yml down --volumes --remove-orphans
```

## Quality Bar

The finished setup should make future behavioral tests straightforward:

- A test author can import fixtures and immediately call the service API.
- Each pytest run starts from clean infrastructure.
- Tests can run repeatedly without manual cleanup.
- Secrets, ports, database names, and buckets are test-only.
- Cross-service dependencies are explicit and intentionally real or fake.
- The stack can be debugged with ordinary `docker compose logs`.
- The harness does not depend on the developer’s dev stack already running.
