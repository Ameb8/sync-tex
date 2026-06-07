---
name: implement-integration-tests
description: Implement one pytest integration test file for a SyncTeX REST backend route group from a service TEST_PLAN.md. Use when the harness already exists and the user provides or identifies one plan route group to convert into black-box tests using that service conftest.py and helpers.
---

# Implement Integration Tests

Implement one SyncTeX REST backend route group from `tests/<service>/TEST_PLAN.md` as one pytest file. The plan is the source of truth. Write only the route-group test file.

## Required Inputs

Before writing code, identify:

- Target service directory, such as `projects-service`.
- Assigned route group section from `tests/<service>/TEST_PLAN.md`, such as `Project Item`.
- Existing harness files under `tests/<service>/`.

If the service or route group is missing and cannot be inferred, ask for it before inspecting files.

## Read Before Writing

Read these files before producing any test code:

1. The assigned route group section from `tests/<service>/TEST_PLAN.md`.
2. `tests/<service>/conftest.py`, to identify fixture names, scopes, and return shapes.
3. Every file under `tests/<service>/helpers/`, to identify exact auth, DB, MinIO, and fake helper APIs.
4. Existing `tests/<service>/test_*.py` files, to match local patterns and avoid collisions.

Do not inspect service source files to re-derive behavior. If the plan and source behavior appear to disagree from already-provided context, implement the plan and leave:

```python
# TODO: verify - plan says 404 but source may differ
```

## Output File

Write exactly one file for the route group:

```text
tests/<service>/test_<resource>_<group>.py
```

Use the repository's existing test naming pattern if one already exists. Otherwise use:

- Collection routes, such as `POST /projects` and `GET /projects`: `test_projects_collection.py`.
- Item routes, such as `GET /projects/:id`, `PATCH /projects/:id`, and `DELETE /projects/:id`: `test_projects_item.py`.
- Named flows, such as `POST /invites` and `POST /invites/:token/accept`: `test_invites_flow.py`.

## File Structure

Every generated test file must use this structure, in this order:

```python
# tests/<service>/test_<resource>_<group>.py
# Route group: <exact group name from TEST_PLAN.md>
# Routes covered: METHOD /path, METHOD /path

import pytest
import requests

# Import helpers by name only when used. Never use wildcard imports.
from helpers.auth import mint_token
from helpers.db import query_row
from helpers.minio import object_exists
from helpers.fakes import set_fake_response


# -- <METHOD> <path> ---------------------------------------------------------

def test_<method>_<resource>_<case>(base_url, unique_user):
    ...


# -- Coverage Gaps -----------------------------------------------------------

# Coverage Gaps: none
```

Remove unused helper imports. Keep `pytest` when using `pytest.mark.parametrize` or `pytest.skip`; otherwise follow existing file style.

## Case Mapping

Convert each row in the route group's case table into one test function.

Function names must be lowercase, underscore-separated, and non-abbreviated:

```text
test_<method>_<resource>_<case_description>
```

Examples: `test_post_projects_happy_path`, `test_post_projects_missing_name`, `test_get_project_unauthenticated`, `test_delete_project_not_found`.

Parametric rows become one parametrized test, not multiple test functions:

```python
@pytest.mark.parametrize("body", [
    {"description": "no name field"},
    {"name": "", "description": "empty name"},
])
def test_post_projects_invalid_body(base_url, unique_user, body):
    user_id, headers = unique_user
    r = requests.post(f"{base_url}/projects", json=body, headers=headers)
    assert r.status_code == 422
```

Multi-step stateful flows stay in one test function with step comments:

```python
def test_post_invites_accept_flow(base_url, unique_user):
    user_id, headers = unique_user

    # Step 1: create invite
    r = requests.post(f"{base_url}/invites", json={"email": "x@example.com"}, headers=headers)
    assert r.status_code == 201
    token = r.json()["token"]

    # Step 2: accept invite
    r = requests.post(f"{base_url}/invites/{token}/accept", headers=headers)
    assert r.status_code == 200
```

## Fixture Rules

Use only fixtures already defined in `tests/<service>/conftest.py`.

- Never define fixtures in test files.
- Never modify `conftest.py`.
- Never add or change helper files.
- Use session-scoped fixtures such as `base_url` for the service URL.
- Use function-scoped fixtures such as `unique_user` for identity and mutable resources.
- Every test requiring auth gets its own identity via `unique_user` or the equivalent per-test fixture.
- Never share user identity or mutable resource state between test functions at module level.

If a needed fixture does not exist, implement the case as skipped and record the gap:

```python
def test_post_projects_owner_limit(base_url, unique_user):
    pytest.skip("requires 'projects_at_limit' fixture - not yet in conftest")
```

## Auth

Use the exact auth pattern from `conftest.py` or `helpers/auth.py`. Do not construct JWTs manually inside test functions.

Valid fixture consumption examples are `user_id, headers = unique_user` or `token = unique_user["token"]` followed by the header pattern already used by the harness.

## Requests And Assertions

Assert only what the assigned plan section specifies.

For happy paths, assert status code, response fields explicitly named in the plan, and side effects explicitly named in the plan. For failure paths, assert only status code unless the plan specifies an error response body.

Allowed when the plan specifies `201` and an `id` field:

```python
assert r.status_code == 201
body = r.json()
assert "id" in body
```

Not allowed unless the plan mentions `created_at` format:

```python
assert body["created_at"].endswith("Z")
```

## Side Effects

When the plan specifies a database, MinIO, cache, or upstream side effect, assert it with an existing helper after the request.

```python
def test_post_projects_happy_path(base_url, unique_user):
    user_id, headers = unique_user
    r = requests.post(f"{base_url}/projects", json={"name": "my project"}, headers=headers)
    assert r.status_code == 201
    project_id = r.json()["id"]

    row = query_row("SELECT id FROM projects WHERE id = %s", project_id)
    assert row is not None
```

Do not assert side effects for failure cases unless the plan explicitly requires them.

## Stubbed Upstreams

If the plan lists a stub contract, configure the fake before calling the service. Use only the API found in `tests/<service>/helpers/fakes.py`.

```python
def test_post_projects_upstream_failure(base_url, unique_user):
    user_id, headers = unique_user
    set_fake_response("users-service", "/users/{id}", status=503)
    r = requests.post(f"{base_url}/projects", json={"name": "x"}, headers=headers)
    assert r.status_code == 503
```

If the plan requires a real external API such as OAuth, an LLM provider, payment, or email, skip the case and record the gap.

## Coverage Gaps

End every test file with a coverage-gaps comment section.

Include:

- Plan rows not implemented, with reasons such as missing fixture, undefined stub contract, ambiguous status code, or external API dependency.
- Routes from the assigned route group skipped for any reason.
- Routes already visible from provided source/router context that match the group's URL pattern but are absent from the plan.

If there are no gaps, write exactly:

```python
# Coverage Gaps: none
```

## Hard Rules

Never do these:

- Import from service source packages, such as `from app.models import Project`.
- Define fixtures inside test files.
- Modify `conftest.py` or helper files.
- Share mutable state between test functions at module level.
- Assert fields, side effects, or status codes not present in the plan.
- Call real external APIs, including OAuth, LLM endpoints, payment, and email.
- Infer behavior from service source to override the plan.
- Write more than the one assigned route-group test file.

## Validation

After writing the test file, run collection for that file:

```bash
python -m pytest -c tests/<service>/pytest.ini tests/<service>/test_<file>.py --collect-only
```

Collection must succeed with zero errors before the task is done. If collection fails, fix import, syntax, or fixture errors and re-run collection.

Do not run the full test file unless the harness stack is already running. If the stack is not running, successful `--collect-only` is sufficient.
