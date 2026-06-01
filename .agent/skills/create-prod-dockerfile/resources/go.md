## Go (Gin REST API / WebSocket Server)

### Base images

**Builder:** `golang:1.23-bookworm` (or the appropriate Go version)

**Runtime:** `gcr.io/distroless/static-debian12` — the Go binary is statically linked and requires no libc or runtime dependencies. `scratch` is also valid if no CA certificates or timezone data are needed; distroless is preferred because it includes these.

### Building the binary

Always produce a fully static binary. The following flags are required:

```dockerfile
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} \
    go build -ldflags="-s -w" -o /app/server ./cmd/server
```

- `CGO_ENABLED=0` — disables cgo, produces a static binary compatible with distroless/scratch
- `GOOS=linux` — always target Linux regardless of the build host OS
- `GOARCH=${TARGETARCH}` — use the BuildKit platform argument for cross-compilation compatibility; substitute a fixed value (`amd64`, `arm64`) only if cross-compilation is not needed
- `-ldflags="-s -w"` — strips symbol table and DWARF debug info, reducing binary size
- `--mount=type=cache` — persists Go build and module caches across builds; dramatically speeds up CI

Output the binary to an absolute path (e.g. `/app/server`) rather than a relative one.

### Runtime stage

The runtime stage contains only the binary and nothing else:

```dockerfile
FROM gcr.io/distroless/static-debian12 AS runtime
COPY --from=builder /app/server /app/server
USER nonroot
ENTRYPOINT ["/app/server"]
```

Do not copy source files, Go toolchain files, or module caches into the runtime stage.

### SIGTERM — required manual wiring

**Go does not handle SIGTERM automatically.** The application must explicitly register signal handlers. This is a hard requirement for both the Gin REST API and the WebSocket server.

Use `signal.NotifyContext` (Go 1.16+) as the idiomatic pattern:

```go
ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
defer stop()
```

Pass this context to the shutdown logic. The Dockerfile instruction file does not dictate implementation details, but the application must perform this wiring before the service is considered production-ready. Note this in any generated Dockerfile as a comment:

```dockerfile
# NOTE: This service requires manual SIGTERM handling in application code.
# See Go signal.NotifyContext pattern. Without it, SIGKILL will terminate
# the process after the orchestrator grace period with no graceful drain.
STOPSIGNAL SIGTERM
```

### Gin REST API — shutdown note

HTTP shutdown must drain in-flight requests before exit. The standard library's `(*http.Server).Shutdown(ctx)` is the correct mechanism. The Dockerfile itself does not implement this, but the comment above should make the requirement explicit.

Set Gin's release mode via environment variable — never hardcode it:

```dockerfile
ENV GIN_MODE=release \
    PORT=8080 \
    LOG_LEVEL=info
```

Debug mode produces verbose per-request logging that is expensive and inappropriate in production.

### WebSocket server — additional shutdown note

`(*http.Server).Shutdown` stops accepting new HTTP upgrade requests but does **not** close existing WebSocket connections. Active WebSocket connections must be tracked and explicitly closed during shutdown — this is an application-level concern that the Dockerfile cannot address. Add a comment to the generated Dockerfile:

```dockerfile
# NOTE: WebSocket servers must track and explicitly close active connections
# on SIGTERM. http.Server.Shutdown alone is insufficient — it does not
# terminate existing WebSocket connections.
```

### Environment

```dockerfile
ENV PORT=8080 \
    LOG_LEVEL=info \
    GIN_MODE=release
```

For WebSocket servers, omit `GIN_MODE` if Gin is not used.

### Full template

```dockerfile
# syntax=docker/dockerfile:1

# ── Builder ────────────────────────────────────────────────────────────────
FROM golang:1.23-bookworm AS builder
WORKDIR /app

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} \
    go build -ldflags="-s -w" -o /app/server ./cmd/server

# ── Runtime ────────────────────────────────────────────────────────────────
FROM gcr.io/distroless/static-debian12 AS runtime

ARG GIT_SHA=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="<repo-url>"

COPY --from=builder /app/server /app/server

ENV PORT=8080 \
    LOG_LEVEL=info \
    GIN_MODE=release

USER nonroot

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/app/server", "-healthcheck"]

# NOTE: This service requires manual SIGTERM handling in application code.
# See Go signal.NotifyContext pattern. Without it, the process will be
# SIGKILLed after the orchestrator grace period with no graceful drain.
#
# WebSocket servers additionally must track and close active connections
# explicitly — http.Server.Shutdown does not terminate existing WebSocket
# connections.
STOPSIGNAL SIGTERM

ENTRYPOINT ["/app/server"]
```

### Healthcheck note for distroless

Distroless has no shell and no `curl`. The healthcheck must use one of:
- A `-healthcheck` flag implemented in the binary itself (preferred — shown above)
- A separate compiled healthcheck binary copied into the runtime stage
- An HTTP check via a minimal compiled tool

Do not use `curl` or `wget` in the healthcheck for distroless images.

### Hard rules

- `CGO_ENABLED=0` is always required for distroless/scratch runtime stages
- `-ldflags="-s -w"` is always required
- `--mount=type=cache` on go build and go mod download steps is always required
- `GIN_MODE=release` must always be set for Gin services
- Never copy source or toolchain into the runtime stage
- Never use shell-form `CMD` or `ENTRYPOINT`
- Always add the SIGTERM wiring comment — do not silently omit it
- Always add the WebSocket drain comment for WebSocket servers