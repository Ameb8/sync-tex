# SyncTeX

Self-hosted collaborative LaTeX IDE. Raspberry Pi 5, Docker Compose, ARM64. Polyglot microservices behind nginx API gateway. 

## Services

| Dir | Lang | Role | Docs |
|-----|------|------|------|
| `users-service/` | Python/FastAPI | Auth, JWT, GitHub OAuth2, Postgres | [README](users-service/README.md) |
| `projects-service/` | Go/Gin, sqlc, pgx, Postgres | File metadata, MinIO presigned URLs, ETag cache, invite links | [README](projects-service/README.md) |
| `collab-service/` | Go | WebSocket Yjs binary relay, snapshot seeding | [README](collab-service/README.md) |
| `file-data-service/` | Rust/yrs, tonic/gRPC | Yjs compaction, text export | [README](file-data-service/README.md) |
| `assistant-service/` | Python/FastAPI, SQLAlchemy, Alembic, Postgres | BYOK LLM keys, provider abstraction, SSE streaming | [README](assistant-service/README.md) |
| `compile-service/` | Go (in progress) | Sandboxed LaTeX compilation, incremental builds | [README](compile-service/README.md) |
| `frontend/` | React, Monaco, Yjs, Vite | Editor, auth, collaboration UI | [README](frontend/README.md) |

## Cross-Cutting Concerns

**Auth**: JWTs issued by `users-service`, validated independently per service. `sub` claim is a string. Type mismatches are a common source of 500s across polyglot services — verify claim types before assuming auth logic is wrong.

**MinIO**: Presigned URLs are generated with the internal Docker hostname, then rewritten to the external hostname before returning to clients. nginx does not proxy MinIO for object payloads. ETag-based cache invalidation used in `projects-service` for text caches. Multiple services access presigned URLs but only projects-service has client and is responsible for it.

**Yjs**: `collab-service` relays raw binary frames without decoding. New clients receive a snapshot before live updates. `file-data-service` owns compaction and plain-text export via `yrs`.

**Migrations**: Alembic for Python services; `golang-migrate` or raw SQL for Go services; Rust service has no migrations (stateless over MinIO/gRPC).

**Datbases**: Each service using Postgres has its own postgres instance, individually owning all data.

**ARM64**: Pin Docker images to `linux/arm64` where multi-arch support is absent.

## Repo Layout

```
nginx/
docker-compose.yml
users-service/
projects-service/
collab-service/
file-data-service/
assistant-service/
compile-service/
frontend/
```