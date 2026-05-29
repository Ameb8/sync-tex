# assistant-service

FastAPI service for project-scoped AI assistance. Owns BYOK LLM keys, chat
history, usage tracking, provider abstraction, SSE streaming, and
auto-context/RAG indexing.

## Source Of Truth

Use code-generated or code-adjacent sources for exact schemas. Do not treat this
file as an endpoint or database schema reference.

- API routes: `app/llm/router.py`, `app/auto_context/router.py`
- Request/response schemas: `app/llm/schemas.py`, `app/auto_context/schemas.py`
- DB models: `app/llm/models.py`, `app/auto_context/models.py`
- DB migrations: `alembic/versions/`
- Provider implementations: `app/llm/providers/`
- Project file/text access: `app/clients/projects_client.py`
- Auto-context indexing: `app/auto_context/indexer.py`
- Context assembly/tracking helpers: `app/context/`

If a stable external API reference is needed, generate it from FastAPI OpenAPI
rather than hand-maintaining endpoint tables here.

## Service Structure

- `app/core/`: auth, crypto, database sessions, logging
- `app/llm/`: API keys, user settings, usage logs, chats, streaming, providers
- `app/auto_context/`: RAG index state, chunking, embeddings, indexing
- `app/context/`: context assembly, mention resolution, context tracking
- `app/clients/`: cross-service clients
- `alembic/`: PostgreSQL migrations for this service
- `tests/`: pytest coverage for service behavior

## Invariants

- JWT `sub` is a string user id.
- Scope user-owned data by `user_id`; never expose chats, keys, settings, or
  usage across users.
- Never log raw API keys. Stored provider keys must remain encrypted at rest.
- BYOK encryption depends on `SECRET_KEY`; avoid changes that make existing
  encrypted keys unreadable without an explicit migration plan.
- Streaming chat responses use SSE from `/chat/stream`.
- Database schema changes require SQLAlchemy model updates, Alembic migrations,
  and focused tests.
- Cross-service project/file access goes through projects-service internal APIs;
  this service should not access MinIO directly except through URLs supplied by
  projects-service.
- Auto-context indexing is background work. Keep request handlers responsive and
  persist per-file failures without failing the whole project index when possible.

## Coding Style

- Use type hints on function definitions, including return types.
- Add variable/type annotations where they make the code more semantic,
  professional, or easier to review. Avoid noisy annotations for obvious locals.
- Prefer existing local patterns over new abstractions.
- Keep comments/docstrings useful and specific. Add them for public helpers,
  non-obvious decisions, security-sensitive code, cross-service contracts, and
  notable inner blocks that would otherwise require careful reconstruction.
- Do not add comments that merely restate the next line of code.
- Keep async SQLAlchemy session ownership clear. Background tasks should create
  their own sessions instead of reusing request-scoped sessions.

## Common Workflows

When changing API behavior:

- Update the router and Pydantic schemas together.
- Check frontend callers and any generated OpenAPI artifact if one exists.
- Add or update tests for auth scoping, validation, and error behavior.

When changing persistence:

- Update SQLAlchemy models.
- Add an Alembic migration in `alembic/versions/`.
- Test migration-sensitive behavior and model CRUD paths.

When adding an LLM provider:

- Implement the provider under `app/llm/providers/`.
- Register it in the provider registry.
- Preserve the existing streaming interface.
- Avoid provider-specific behavior leaking into API schemas unless it is a
  deliberate product/API change.

When changing auto-context/RAG:

- Check chunking, embedding dimensions, index state transitions, and failure
  persistence.
- Keep projects-service as the source for project file lists and text URLs.

## Environment

Important environment variables include:

- `DATABASE_URL`
- `SECRET_KEY`
- `JWT_SECRET`
- `PROJECTS_SERVICE_URL`
- `PROJECTS_INTERNAL_API_KEY`

Verify current code before adding new required variables.

## Tests

Use pytest for assistant-service tests. From `assistant-service/`:

- `make test` for normal edit/verify loops
- `make test-cov` for coverage
- `make test-container` for container parity
- `make test-container-build` after dependency, Dockerfile, compose, or runtime
  changes

Prefer `make test` during normal development. Use container tests only when behavior
may depend on image contents, dependency resolution, or Docker networking, not for standard logic/feature updates.
