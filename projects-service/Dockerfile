# syntax=docker/dockerfile:1

FROM golang:1.25-alpine AS builder

WORKDIR /app

# Install dependencies
RUN apk add --no-cache git

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source
COPY . .

# Build
RUN CGO_ENABLED=0 GOOS=linux go build -o /projects-service ./cmd/server

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
		port = "8003"
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

CGO_ENABLED=0 GOOS=linux go build -o /healthcheck /tmp/healthcheck.go
EOF

FROM alpine:latest

RUN apk --no-cache add ca-certificates

WORKDIR /root/

# Copy binary
COPY --from=builder /projects-service .
COPY --from=builder /healthcheck /healthcheck

# Copy migrations
COPY --from=builder /app/db/migrations ./db/migrations

EXPOSE 8003

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/healthcheck"]

STOPSIGNAL SIGTERM

CMD ["./projects-service"]
