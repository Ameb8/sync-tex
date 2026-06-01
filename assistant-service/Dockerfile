# syntax=docker/dockerfile:1

# Build dependencies in a full Python image so the runtime image can stay small.
FROM python:3.12-bookworm@sha256:79b22efca6dbdf3dfa620bfafe35e0c66d97b9b832c1ad8349d4d42fbd9aa9ab AS builder

WORKDIR /app

# Keep Python and pip behavior deterministic in containers.
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Install dependencies into an isolated virtualenv that can be copied as a unit.
RUN python -m venv /app/.venv

COPY requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    /app/.venv/bin/python -m pip --require-virtualenv install --upgrade pip setuptools wheel \
    && /app/.venv/bin/python -m pip --require-virtualenv install -r requirements.txt

# Copy application and migration files after dependency installation to improve
# Docker layer cache reuse when source files change.
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./alembic.ini

# Run the service from the slimmer Python image with only runtime artifacts.
FROM python:3.12-slim-bookworm@sha256:93ab4b7fa528b25124c97bcc755415e60eb671a86b4dbe0328df2fe2d1c1193d AS runtime

WORKDIR /app

# Build metadata is supplied by docker-compose or CI when available.
ARG GIT_SHA=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="SyncTeX Assistant Service" \
      org.opencontainers.image.description="FastAPI service for SyncTeX AI assistance" \
      org.opencontainers.image.source="https://github.com/ameb8/sync-tex" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}"

# Drop privileges before running the FastAPI process.
RUN addgroup --system appgroup \
    && adduser --system --ingroup appgroup --home /app --no-create-home appuser

# Copy only the prepared virtualenv and service source into the runtime image.
COPY --from=builder --chown=appuser:appgroup /app/.venv /app/.venv
COPY --from=builder --chown=appuser:appgroup /app/app /app/app
COPY --from=builder --chown=appuser:appgroup /app/alembic /app/alembic
COPY --from=builder --chown=appuser:appgroup /app/alembic.ini /app/alembic.ini

# Make the virtualenv first on PATH and configure default service settings.
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH=/app \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000 \
    LOG_LEVEL=info

USER appuser

EXPOSE 8000

# The health endpoint is served by FastAPI and used by Compose/nginx readiness.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=5).read()"]

STOPSIGNAL SIGTERM

# Run a single Uvicorn worker; horizontal scaling is handled at the container level.
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
