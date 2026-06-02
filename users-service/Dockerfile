# syntax=docker/dockerfile:1

# Build dependencies in a full Python image so the runtime image can stay small.
FROM python:3.11-bookworm@sha256:121d86b6d08752968a7dddbc708849e5f3a839bbff47f32212b46d2a1d842bab AS builder

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

# Copy service source after dependency installation to improve Docker layer
# cache reuse when application files change.
COPY handlers.py main.py models.py schemas.py security.py ./

# Run the service from the slimmer Python image with only runtime artifacts.
FROM python:3.11-slim-bookworm@sha256:8dca233de9f3d9bb410665f00a4da6dd06f331083137e0e98ccf227236fcc438 AS runtime

WORKDIR /app

# Build metadata is supplied by docker-compose or CI when available.
ARG GIT_SHA=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="sync-tex-users-service" \
      org.opencontainers.image.description="SyncTeX FastAPI authentication and user service" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="https://github.com/ameb8/sync-tex/tree/main/users-service"

# Drop privileges before running the FastAPI process.
RUN addgroup --system appgroup \
    && adduser --system --ingroup appgroup --home /app --no-create-home appuser

# Copy only the prepared virtualenv and service source into the runtime image.
COPY --from=builder --chown=appuser:appgroup /app/.venv /app/.venv
COPY --from=builder --chown=appuser:appgroup /app/handlers.py /app/main.py \
    /app/models.py /app/schemas.py /app/security.py ./

# Make the virtualenv first on PATH and configure default service settings.
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8001 \
    LOG_LEVEL=info

USER appuser

EXPOSE 8001

# The health endpoint is served by FastAPI and used by Compose/nginx readiness.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=5).read()"]

STOPSIGNAL SIGTERM

# Run a single Uvicorn worker; horizontal scaling is handled at the container level.
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"]
