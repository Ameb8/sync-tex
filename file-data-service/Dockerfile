# syntax=docker/dockerfile:1

# Builder stage: compile the Rust tonic service and generate protobuf bindings.
# The digest pins the multi-arch manifest used by Docker, including linux/arm64
# for Raspberry Pi deployments.
FROM rust:1.94-bookworm@sha256:6ae102bdbf528294bc79ad6e1fae682f6f7c2a6e6621506ba959f9685b308a55 AS builder

WORKDIR /app

# protoc is required by tonic-build. OpenSSL headers are required because
# reqwest currently uses default native-tls features.
RUN export DEBIAN_FRONTEND=noninteractive \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        libssl-dev \
        pkg-config \
        protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

# The shared protobuf directory is supplied by Compose BuildKit
# `additional_contexts` as `root-proto`. This must match build.rs, which reads
# proto/compaction.proto from the service build context.
COPY --from=root-proto . ./proto

# Copy manifests before source so dependency compilation can be cached when only
# application code changes. `--locked` guarantees Cargo.lock is the source of
# truth for reproducible production builds.
COPY Cargo.toml Cargo.lock ./
COPY build.rs ./

# Build a stub binary to warm the dependency cache. Then clean only this package
# so Cargo cannot accidentally reuse the dummy `fn main() {}` binary after the
# real source tree is copied in.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    mkdir src \
    && printf 'fn main() {}\n' > src/main.rs \
    && cargo build --release --locked \
    && cargo clean --release -p compaction-service \
    && rm -rf src

COPY src ./src

# Compile the real service and copy it out of the cache-mounted target
# directory. Cache mounts are not persisted into image layers.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release --locked \
    && cp target/release/compaction-service /app/server

# Docker healthchecks cannot rely on curl/wget in minimal images. This service
# does not currently implement the standard gRPC health protocol, so the probe
# performs a conservative TCP liveness check against the gRPC listener.
RUN <<'EOF'
cat > /tmp/healthcheck.rs <<'RS'
use std::env;
use std::net::{SocketAddr, TcpStream};
use std::process;
use std::time::Duration;

fn grpc_port() -> String {
    let addr = env::var("GRPC_ADDR").unwrap_or_else(|_| "[::]:50051".to_string());
    addr.rsplit(':')
        .next()
        .filter(|port| port.chars().all(|c| c.is_ascii_digit()))
        .unwrap_or("50051")
        .to_string()
}

fn can_connect(addr: &str) -> bool {
    let timeout = Duration::from_secs(2);
    match addr.parse::<SocketAddr>() {
        Ok(socket_addr) => TcpStream::connect_timeout(&socket_addr, timeout).is_ok(),
        Err(_) => false,
    }
}

fn main() {
    let port = grpc_port();
    let ipv4 = format!("127.0.0.1:{port}");
    let ipv6 = format!("[::1]:{port}");

    if can_connect(&ipv4) || can_connect(&ipv6) {
        process::exit(0);
    }

    process::exit(1);
}
RS

rustc -O /tmp/healthcheck.rs -o /app/healthcheck
EOF

# Runtime stage: keep only the service binary, healthcheck helper, CA roots, and
# OpenSSL runtime library. This uses slim Debian instead of distroless because
# reqwest currently links native-tls/OpenSSL and needs libssl at runtime.
FROM debian:bookworm-slim@sha256:0104b334637a5f19aa9c983a91b54c89887c0984081f2068983107a6f6c21eeb AS runtime

WORKDIR /app

ARG GIT_SHA=unknown
ARG BUILD_DATE=unknown

# OCI labels let CI and operators trace a built image back to its source commit.
LABEL org.opencontainers.image.title="SyncTeX File Data Service" \
      org.opencontainers.image.description="Rust tonic gRPC service for Yjs compaction and text export" \
      org.opencontainers.image.source="https://github.com/ameb8/sync-tex/tree/main/file-data-service" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}"

# Install only runtime OS dependencies and create a dedicated unprivileged user.
RUN export DEBIAN_FRONTEND=noninteractive \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libssl3 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system appgroup \
    && useradd --system --gid appgroup --home-dir /app --no-create-home appuser

# Copy artifacts with final ownership so the runtime container never needs root
# privileges to read or execute them.
COPY --from=builder --chown=appuser:appgroup /app/server /app/server
COPY --from=builder --chown=appuser:appgroup /app/healthcheck /app/healthcheck

# Safe defaults for Compose production use. Secrets are intentionally excluded
# and must be injected by the orchestrator when needed.
ENV GRPC_ADDR="[::]:50051" \
    RUST_LOG=info

USER appuser

# gRPC API port. EXPOSE is metadata only; Compose controls actual networking.
EXPOSE 50051

# The TCP probe checks that the service is accepting local gRPC connections.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/app/healthcheck"]

# NOTE: This service requires SIGTERM handling in application code.
# Use tokio::signal::unix::signal(SignalKind::terminate()) and wire it into
# tonic server shutdown. Without it, the process is SIGKILLed after the
# orchestrator grace period with no graceful drain.
STOPSIGNAL SIGTERM

ENTRYPOINT ["/app/server"]
