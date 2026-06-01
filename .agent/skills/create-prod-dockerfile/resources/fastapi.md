## FastAPI (Uvicorn)

### Base images

**Builder:** `python:3.12-bookworm` (or the appropriate Python version)

**Runtime:** `python:3.12-slim-bookworm` — distroless Python is impractical with virtualenvs; slim is the correct choice here.

### Dependency installation

Always install into a virtualenv inside the builder stage. Copy the entire venv into the runtime stage — do not reinstall dependencies in the runtime stage.

```dockerfile
FROM python:3.12-bookworm AS builder
WORKDIR /app

RUN python -m venv /app/.venv

COPY <dependency-manifest> ./
RUN --mount=type=cache,target=/root/.cache/pip \
    /app/.venv/bin/pip install --require-virtualenv <install-command>
```

Never install dev dependencies (test frameworks, linters, type checkers) in the runtime stage. Use whatever mechanism the project's package manager provides to exclude them (e.g. `--no-dev`, `--only main`, a separate `requirements.txt`).

**Runtime stage venv wiring:**
```dockerfile
COPY --from=builder /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"
```

Do not activate the virtualenv via a shell source command. Setting `PATH` is the correct method for non-interactive containers.

### Running the server

Always invoke Uvicorn via the Python module form:

```dockerfile
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
```

This ensures the venv's Uvicorn is used and the Python path is resolved correctly.

Use `--workers 1` inside containers. Do not fight the container model with multiple workers — horizontal scaling is done via replicas at the orchestration layer. If multiple workers per container are required, use Gunicorn as the process manager with the Uvicorn worker class:

```dockerfile
CMD ["python", "-m", "gunicorn", "main:app", "-k", "uvicorn.workers.UvicornWorker", "--workers", "2", "--bind", "0.0.0.0:8080"]
```

### SIGTERM

Uvicorn handles SIGTERM automatically. No manual signal wiring is required. When SIGTERM is received, Uvicorn stops accepting new requests and waits for in-flight requests to complete before exiting. `STOPSIGNAL SIGTERM` in the Dockerfile is sufficient.

### Startup and shutdown logic

The application may use a lifespan context manager to initialize resources (database connection pools, caches, loaded models, etc.) on startup and release them on shutdown. This is the correct pattern and runs cleanly on SIGTERM-triggered shutdown.

The healthcheck endpoint must not return 200 until lifespan startup has fully completed. There is a gap between the process starting and the application being ready — the `--start-period` in `HEALTHCHECK` should account for this:

```dockerfile
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8080}/healthz || exit 1
```

Adjust `--start-period` based on how long lifespan initialization realistically takes (model loading, migrations, etc.).

### Environment

Set production mode via environment variable:

```dockerfile
ENV PORT=8080 \
    LOG_LEVEL=info
```

Pass `--log-level ${LOG_LEVEL}` to Uvicorn via the CMD if the application does not configure Uvicorn logging itself.

### Full template

```dockerfile
# syntax=docker/dockerfile:1

# ── Builder ────────────────────────────────────────────────────────────────
FROM python:3.12-bookworm AS builder
WORKDIR /app

RUN python -m venv /app/.venv

COPY <dependency-manifest> ./
RUN --mount=type=cache,target=/root/.cache/pip \
    /app/.venv/bin/pip install --require-virtualenv <install-command>

COPY . .

# ── Runtime ────────────────────────────────────────────────────────────────
FROM python:3.12-slim-bookworm AS runtime
WORKDIR /app

ARG GIT_SHA=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="<repo-url>"

RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser

COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/<source> ./<source>

ENV PATH="/app/.venv/bin:$PATH" \
    PORT=8080 \
    LOG_LEVEL=info

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:${PORT}/healthz || exit 1

STOPSIGNAL SIGTERM

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
```

### Hard rules

- Never install dependencies in the runtime stage
- Never use bare `uvicorn` binary in CMD — always `python -m uvicorn`
- Never activate a virtualenv via shell source — set `PATH` instead
- Never set `--workers` > 1 unless Gunicorn is the process manager
- Never copy the entire build context into the runtime stage — only the venv and application source