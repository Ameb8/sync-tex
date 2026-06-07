---
name: plan-integration-tests
description: Generate a structured black-box integration test plan for a SyncTeX REST backend service after its test harness has been set up but before test cases are implemented. Use when given a service directory, route file, OpenAPI/schema, or a request such as "figure out what to test", "list the test cases", "plan integration tests", or "what should I test" for any SyncTeX REST backend service. Produces one markdown plan document and does not write test code.
---

# Plan Integration Tests

Create a source-grounded integration test plan for one SyncTeX REST backend service. The output is a single markdown file at `tests/<service>/TEST_PLAN.md`. Do not implement tests or modify service source.

## Workflow

1. Confirm the target service directory from the user request. If missing and it cannot be inferred, ask for it before inspecting code.
2. Inspect the service source before planning. Treat source code as ground truth even when an OpenAPI/schema file is provided.
3. Enumerate every REST route with method, path, handler, auth requirement, request shape, response shape, side effects, and visible error behavior.
4. Group routes by shared fixtures/state, then write route-level cases with exact expected statuses and side-effect assertions.
5. Write only `tests/<service>/TEST_PLAN.md`.
6. Report only counts, gaps, and required stub contracts after writing the file.

## Source Inspection Checklist

Read only enough code to make the plan executable by another agent without re-reading the service.

**Routes and handlers**

- Go/Gin: start with `main.go`, `router.go`, `routes.go`, handler packages, and middleware wiring.
- FastAPI: start with `main.py`, `app/routers/`, `app/api/`, dependency modules, and middleware registration.
- Record every route as `METHOD /path -> handler`. Do not skip health/readiness routes.

**Auth**

- Find JWT validation and identity extraction. Do not assume claim names or types.
- Record claim key, claim value type, failure statuses, and which routes require auth.
- Pay attention to SyncTeX polyglot claim mismatches: Python may use `sub`; Go services may use custom context keys such as `userId`; UUIDs are commonly strings.

**Requests, responses, and validation**

- For each route, find body/query/path schemas, required fields, optional fields, validation tags, Pydantic validators, binding rules, and response models.
- Record only response fields and validation failures visible in code/schema.

**Persistence and side effects**

- Identify owned database tables, migrations, sqlc queries, repository methods, MinIO buckets/objects, presigned URL behavior, events, and background work.
- Use these as first-class assertions in happy-path and relevant failure cases.

**Errors**

- Find explicit status codes, domain errors, middleware errors, and exception handlers.
- Do not invent `404`, `409`, `422`, or `500` behavior. If code is ambiguous, mark it as requiring verification.

**Cross-service dependencies**

- Identify HTTP/gRPC calls to other SyncTeX services and external systems.
- Record the call site, URL/method or RPC, request shape, and expected stub responses needed for happy-path and dependency-failure cases.

## Test Grouping Rules

Group routes by shared fixtures and state, usually by resource or flow.

- Collection routes, such as `POST /projects` and `GET /projects`, should share a group.
- Item routes, such as `GET /projects/:id`, `PATCH /projects/:id`, and `DELETE /projects/:id`, should share a group.
- Stateful flows, such as invite creation and acceptance, should be their own group even when they span resources.
- Health/readiness can be a small separate group if it has no shared auth/state.

## Coverage Rules

Every route must have at least:

- One happy-path case.
- One unauthenticated case if the route requires auth.
- One malformed/invalid token case if middleware distinguishes it or the harness can produce it.
- One case per required request field showing the actual validation failure.
- One case per visible domain failure, such as not found, forbidden, duplicate, stale ETag, invalid owner, expired invite, or upstream failure.

Apply these planning constraints:

- Use parametric rows for repeated validation cases instead of expanding many near-identical rows.
- Include side-effect assertions for any database, MinIO, cache, event, or upstream interaction.
- For stateful flows, list steps in order and name the fixture/value that carries state between steps.
- If a route has no interesting failures beyond auth and validation, state that explicitly.
- If behavior cannot be verified from source/schema, include a note instead of guessing.

## Output Format

Write this exact structure, adapting section names to the service.

```markdown
# Integration Test Plan: <ServiceName>

## Service Summary

- Auth claim: `<key>` (`<type>`) - required on: <route patterns>
- Owned persistence: <tables, buckets, caches, or "none">
- Stubbed upstreams: <service/dependency names and contract summary, or "none">
- Health endpoint: `GET <path>` -> <status> <response shape>
- Source references: <key files inspected>

## Test Groups

### <Group Name>

**Routes covered**: `METHOD /path`, `METHOD /path`
**Fixtures needed**: <fixtures expected from the existing harness, plus new fixture names if needed>
**Shared setup**: <state that must exist before cases run, or "none">

#### `METHOD /path`

| Case | Inputs | Expected status | Side effects | Notes |
|------|--------|-----------------|--------------|-------|
| Happy path | valid body + auth | 201 | row in `<table>` | response includes `<field>` |
| Missing required field (`field`) | body without `field` + auth | 422 | none | parametrize over: `field_a`, `field_b` |
| Unauthenticated | valid body, no token | 401 | none | auth middleware |
| Domain failure | duplicate `<field>` + auth | 409 | none | only if code returns 409 |

**Parameters**:

```python
valid_body = {"field": "value"}
missing_required_fields = ["field"]
```

**Stub contracts**:

- `<dependency>` happy path: request `<method/path/RPC>` with `<shape>` returns `<status/body>`.
- `<dependency>` failure: request `<method/path/RPC>` returns `<status/error>` and service returns `<status>`.

**Gotchas**: <non-obvious implementation details, or "none">
```

Repeat the route subsection for every route in the group. Keep the document implementation-ready, not prose-heavy.

## Final Response

After writing `tests/<service>/TEST_PLAN.md`, respond with:

- Total route count.
- Total planned test case count.
- Routes or behaviors that could not be planned because source information was missing.
- Cross-service stubs that need contracts before implementation can begin.

Do not summarize the plan content in the conversation.
