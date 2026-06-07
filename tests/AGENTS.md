# Tests

This directory contains service-scoped pytest integration test harnesses for
SyncTeX backend services. Tests here should exercise services through their
public HTTP, WebSocket, gRPC, storage, or container boundaries instead of
importing private implementation details.

## Directory Layout

- Each service gets its own subdirectory, for example `tests/projects-service/`.
- A service test directory owns its test harness: `conftest.py`, Docker Compose
  test stack files, helper modules, requirements, and route-group test files.
- Test files should be organized by externally visible behavior, route group, or
  protocol surface. Do not mirror private source layout when that makes
  black-box integration tests harder to understand.
- Put reusable service-specific setup in that service's `conftest.py` or
  `helpers/` package instead of duplicating clients, auth tokens, database
  setup, or storage setup across test files.

## Python Style

- Use clear test, fixture, and helper names that describe behavior and expected
  outcomes.
- Add docstrings to fixtures and helpers when their purpose, lifecycle, or
  return shape is not obvious.
- Use type hints for public helpers, fixtures with non-obvious return values,
  and complex data structures.
- Do not add type hints to every local variable.
- Keep helper functions small and focused. Avoid broad abstractions until
  repeated setup or assertions are clearly shared.
- Prefer explicit assertions over clever loops or generated checks that hide the
  failing condition.
- Keep comments rare and useful. Comments should explain intent, lifecycle, or
  cross-service assumptions, not restate the code.

## Pytest Style

- Follow the Arrange, Act, Assert pattern. Use whitespace or short comments when
  needed to make the three phases easy to scan.
- Use `@pytest.mark.parametrize` when the same behavior should be checked across
  multiple inputs, roles, status codes, or payload variants.
- Prefer the `mocker` fixture from `pytest-mock` over
  `unittest.mock.patch` for scoped mocks.
- Use `yield` fixtures for setup that requires explicit teardown.
- Keep fixture scopes as narrow as practical. Use `session` scope only for
  expensive shared resources such as Docker stacks.
- Do not make tests depend on execution order.
- Prefer per-test unique users, projects, buckets, object names, or IDs over
  global cleanup when isolation is simpler.
- Assert response status codes before reading response bodies.
- Include response text or JSON in assertion messages when diagnosing API
  failures would otherwise be difficult.
- Configure default pytest behavior in versioned pytest config files instead of
  hardcoding flags in commands. Prefer a root `pyproject.toml` for new shared
  pytest defaults; service-local config is acceptable only when the setting is
  genuinely service-specific.

## Integration Test Rules

- Treat tests as black-box checks unless a test plan explicitly calls for a
  narrower unit or component test.
- Prefer real service dependencies from the test harness over mocks. Mock only
  external systems that are unavailable, slow, nondeterministic, or outside the
  route group being tested.
- Validate auth behavior with JWT claims that match the service contract. In
  this repo, `sub` claim type mismatches are a common failure source.
- Keep MinIO behavior aligned with production expectations: services may rewrite
  presigned URLs, and nginx does not proxy object payloads.
- For Yjs-related tests, treat update payloads as binary protocol data unless
  the owning service explicitly decodes them.
- Document any intentionally accepted ambiguity, such as APIs that may return
  either `403` or `404` to avoid disclosing resource existence.

## Agent Expectations

- Read this file before adding or modifying pytest tests under `tests/`.
- Reuse existing fixtures and helpers before adding new ones.
- If a generated test violates one of these standards for a practical reason,
  leave a short comment in the code or explain the tradeoff in the final
  response.
