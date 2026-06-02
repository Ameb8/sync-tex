# syntax=docker/dockerfile:1

# Build on the host architecture while targeting the requested runtime
# architecture. This keeps Docker BuildKit cross-platform builds fast and
# explicit for ARM64 Raspberry Pi deployments.
FROM --platform=$BUILDPLATFORM docker.io/library/golang:1.24.4-bookworm@sha256:10f549dc8489597aa7ed2b62008199bb96717f52a8e8434ea035d5b44368f8a6 AS builder

WORKDIR /app

ARG TARGETARCH

# Download dependencies before copying the full source tree so Docker can reuse
# the module cache when application code changes but go.mod/go.sum do not.
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .

# Build a static Linux binary for the target architecture. CGO is disabled so
# the final distroless image does not need libc or other dynamic libraries.
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /app/server ./cmd/server

# Distroless images do not include curl or wget, so compile a tiny static
# healthcheck client into the runtime image instead.
RUN <<'EOF'
cat > /tmp/healthcheck.go <<'GO'
package main

import (
	"net/http"
	"os"
	"time"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	client := http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + port + "/health")
	if err != nil {
		os.Exit(1)
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		os.Exit(1)
	}
}
GO

CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /app/healthcheck /tmp/healthcheck.go
EOF

# Use a minimal nonroot runtime image. The digest is pinned so builds are
# reproducible even if the upstream latest tag changes.
FROM gcr.io/distroless/static-debian12:latest@sha256:9c346e4be81b5ca7ff31a0d89eaeade58b0f95cfd3baed1f36083ddb47ca3160 AS runtime

WORKDIR /app

# Build metadata is surfaced as OCI labels for image inspection and traceability.
ARG GIT_SHA=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="sync-tex-collab-service" \
      org.opencontainers.image.description="SyncTeX raw Yjs WebSocket collaboration relay" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="https://github.com/ameb8/sync-tex/tree/main/collab-service"

COPY --from=builder /app/server /app/server
COPY --from=builder /app/healthcheck /app/healthcheck

# Defaults are suitable for docker-compose; callers can override them per
# environment without rebuilding the image.
ENV PORT=8080 \
    LOG_LEVEL=info \
    PROJECTS_SERVICE_URL=http://projects-service:8003 \
    SAVE_DEBOUNCE_MS=5000

# Drop privileges in the runtime container. The distroless image provides this
# nonroot user.
USER nonroot

EXPOSE 8080

# Probe the in-process HTTP health endpoint with the compiled static helper.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/app/healthcheck"]

# NOTE: This service requires manual SIGTERM handling in application code.
# See Go signal.NotifyContext. Without it, the process can be SIGKILLed
# after the orchestrator grace period with no graceful drain.
#
# NOTE: WebSocket servers must track and explicitly close active connections
# on SIGTERM. http.Server.Shutdown alone does not terminate existing
# WebSocket connections.
STOPSIGNAL SIGTERM

ENTRYPOINT ["/app/server"]

