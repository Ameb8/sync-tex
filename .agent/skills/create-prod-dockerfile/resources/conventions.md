# Production Dockerfile Instructions

You are generating a production-grade Dockerfile for a backend service. Follow every rule in this file exactly. Language- and framework-specific instructions will be appended below; they take precedence over any defaults stated here.

---

## Structure: always use multi-stage builds

Every Dockerfile must have at least two stages:

- **builder** — compiles, installs dependencies, runs any build step
- **runtime** — lean final image containing only what is needed to run the service

Nothing from the builder stage bleeds into the runtime image unless explicitly copied with `COPY --from=builder`.

```dockerfile
# syntax=docker/dockerfile:1
FROM <build-image> AS builder
# ... install deps, compile ...

FROM <runtime-image> AS runtime
COPY --from=builder /app/dist ./dist
# ... minimal runtime setup ...
```

The `# syntax=docker/dockerfile:1` pragma must always be the first line. It enables BuildKit features including `--mount=type=cache` for package manager caches.

---

## Base image

**Builder stage:** use the full SDK/toolchain image for the language (e.g. `golang:1.23-bookworm`, `node:20-bookworm`, `python:3.12-bookworm`).

**Runtime stage:** use the smallest viable image. Preference order:
1. `gcr.io/distroless/<runtime>` — no shell, minimal attack surface (preferred)
2. `<lang>:<version>-slim` — stripped debian, has a shell (use when distroless is impractical)
3. `alpine` — only if the language ecosystem supports musl well (Go static binaries are fine; Python/Node generally are not)

**Always pin to a digest in production:**
```dockerfile
FROM node:20-slim@sha256:<digest> AS builder
```
Use Dependabot or Renovate to automate digest bumps.

---

## Layer caching

Order instructions from least-frequently-changing to most-frequently-changing so cache invalidation is minimized:

1. Install OS-level packages
2. Copy dependency manifests only (e.g. `package.json`, `go.mod`, `requirements.txt`)
3. Install dependencies
4. Copy application source
5. Build/compile

```dockerfile
# Good — deps cached independently of source changes
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Bad — source copy before dep install busts cache on every commit
COPY . .
RUN npm ci && npm run build
```

Merge related `RUN` commands into a single layer. Always clean up package manager caches in the same `RUN` step that creates them:

```dockerfile
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
```

---

## Security

**Non-root user.** The runtime container must never run as root. Create a dedicated system user in the runtime stage and switch to it before `ENTRYPOINT`/`CMD`:

```dockerfile
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
USER appuser
```

Distroless images provide `nonroot` / `65532` — use `USER nonroot` or `USER 65532`.

**No secrets in the image.** Never use `ENV`, `ARG`, or `COPY` to bake credentials, API keys, or `.env` files into an image layer. Secrets are injected at runtime via the orchestrator (Docker secrets, Kubernetes secrets, environment injection, or a secrets manager).

**Minimal `.dockerignore`.** Always include at minimum:
```
.git
.env*
*.log
**/node_modules
**/dist
**/__pycache__
```

**Scan images in CI.** Run Trivy or Grype against the final image and fail the pipeline on HIGH or CRITICAL CVEs.

---

## Runtime configuration

**Exec form only for `ENTRYPOINT` and `CMD`.** Shell form (`CMD node server.js`) makes `/bin/sh` PID 1, preventing SIGTERM from reaching the application. Always use exec form:

```dockerfile
# Correct
ENTRYPOINT ["/nodejs/bin/node"]
CMD ["dist/server.js"]

# Wrong — shell form
CMD node dist/server.js
```

**Graceful shutdown.** Set `STOPSIGNAL SIGTERM`. The application must listen for SIGTERM, stop accepting new connections, finish in-flight requests, flush logs, then exit cleanly. The orchestrator's default grace period is typically 30 seconds.

```dockerfile
STOPSIGNAL SIGTERM
```

**Port declaration:**
```dockerfile
EXPOSE 8080
```
This is documentation and tooling metadata, not a firewall rule. Always include it.

**Environment variables** for runtime tuning (e.g. `PORT`, `LOG_LEVEL`, `NODE_ENV`) should be declared with `ENV` using safe defaults only — never secrets:
```dockerfile
ENV PORT=8080 \
    LOG_LEVEL=info
```

---

## Observability

**Logs to stdout/stderr only.** Never write logs to files inside the container. The runtime collects stdout/stderr and routes to the log aggregator. Structured JSON logging is preferred.

**Healthcheck.** Every service image must include a `HEALTHCHECK`:

```dockerfile
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8080}/healthz || exit 1
```

If the runtime image has no shell (distroless), implement the health check as a compiled binary or use a language-native one-liner passed via exec form. Expose a `/healthz` (liveness) endpoint in the application.

**OCI labels.** Include image metadata so built artifacts are traceable:

```dockerfile
ARG GIT_SHA=unknown
ARG BUILD_DATE=unknown
LABEL org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="<repo-url>"
```

Pass `--build-arg GIT_SHA=$(git rev-parse HEAD)` from CI.

---

## WORKDIR

Always set `WORKDIR` explicitly in both stages. Never rely on implicit working directory. Use `/app` unless a language convention dictates otherwise:

```dockerfile
WORKDIR /app
```

---

## Full template (language-agnostic)

```dockerfile
# syntax=docker/dockerfile:1

# ── Builder ────────────────────────────────────────────────────────────────
FROM <build-image>@sha256:<digest> AS builder
WORKDIR /app

# Install OS build deps if needed
RUN apt-get update \
    && apt-get install -y --no-install-recommends <packages> \
    && rm -rf /var/lib/apt/lists/*

# Dependency manifests first (cache layer)
COPY <manifest-files> ./
RUN <install-deps>

# Source + build
COPY . .
RUN <build-command>

# ── Runtime ────────────────────────────────────────────────────────────────
FROM <runtime-image>@sha256:<digest> AS runtime
WORKDIR /app

ARG GIT_SHA=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="<repo-url>"

# Non-root user
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser

# Copy only runtime artifacts from builder
COPY --from=builder /app/<output> ./

USER appuser

ENV PORT=8080 \
    LOG_LEVEL=info

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${PORT}/healthz || exit 1

STOPSIGNAL SIGTERM

ENTRYPOINT ["<entrypoint>"]
CMD ["<args>"]
```

---

## Hard rules (never violate)

- No secrets or credentials in any image layer
- No shell form `CMD` or `ENTRYPOINT`
- No running as root in the runtime stage
- No log files inside the container
- No missing `HEALTHCHECK`
- No missing `STOPSIGNAL SIGTERM`
- No single-stage build for a compiled or dependency-heavy service

---
