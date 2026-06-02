## Rust (Tokio / tonic gRPC)

### Base images

**Builder:** `rust:1.XX-bookworm` (pin to the same Rust version used in the project)

**Runtime:** `gcr.io/distroless/cc-debian12` — the Rust binary links against a small set of C libraries (libgcc, libm) even with `--release`. `cc` distroless includes these. Do not use `distroless/static` or `scratch` unless the binary is verified 100% statically linked (requires musl target, see note below).

If a fully static binary is needed, compile against `x86_64-unknown-linux-musl` / `aarch64-unknown-linux-musl` and use `distroless/static-debian12` or `scratch` as the runtime. This requires adding the musl target and a C cross-compiler — only do this if the project already supports it.

### System dependencies

tonic gRPC services require `protobuf-compiler` at build time to compile `.proto` files. This must be installed in the builder stage only — it is never needed at runtime.

If the service uses TLS (`rustls` is pure-Rust and needs nothing; `native-tls` requires `libssl-dev` at build time and `libssl3` at runtime):
- Prefer `rustls` for zero-runtime-dependency TLS
- If `native-tls` is required, install `libssl3` in the runtime stage via a minimal apt step

```dockerfile
# Builder: proto compiler + any C build deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    protobuf-compiler \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*
```

### Proto files

If the service consumes a shared `.proto` definition from outside its own directory (e.g. a monorepo root `proto/` directory), it must be passed in via BuildKit `additional_contexts` — the same pattern used in the dev Dockerfile:

```yaml
# docker-compose.yml
build:
  context: ./my-service
  additional_contexts:
    root-proto: ./proto
```

```dockerfile
# Dockerfile
COPY --from=root-proto . ./proto
```

This pattern must be preserved exactly in the production Dockerfile. Do not inline proto files or change the mount path without confirming the `build.rs` proto include paths are updated accordingly.

### Dependency caching

Rust compile times are long. Cache dependencies by copying manifests and a stub `main.rs` first, building dependencies only, then removing the stub artifacts before the real build. This is the standard Rust Docker caching pattern:

```dockerfile
COPY Cargo.toml Cargo.lock ./
COPY build.rs ./
COPY --from=root-proto . ./proto

# Stub build — caches all dependency compilation
RUN mkdir src && echo 'fn main() {}' > src/main.rs \
    && cargo build --release \
    && rm -f target/release/<binary-name> \
       target/release/<binary-name>.d \
    && rm -rf target/.fingerprint/<binary-name>-* \
    && rm -rf src
```

**The stub cleanup step is mandatory.** Without removing the stub binary and its fingerprint, Cargo will not recompile `main.rs` when the real source is copied in — it sees the dependency timestamps as satisfied. Remove:
- `target/release/<binary-name>` — the stub binary
- `target/release/<binary-name>.d` — the dep file
- `target/.fingerprint/<binary-name>-*` — the fingerprint dir (glob)

Replace `<binary-name>` with the actual binary name from `Cargo.toml` `[[bin]]` or the package name.

Use `--mount=type=cache` for the cargo registry and build cache to avoid re-downloading crates across builds:

```dockerfile
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release
```

Note: `--mount=type=cache` on `target/` requires that the binary be copied out of the cache mount before the layer completes, since cache mounts are not preserved in the image layer:

```dockerfile
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release \
    && cp target/release/<binary-name> /app/server
```

### Release build flags

Always build with `--release`. Optionally add to `Cargo.toml` for smaller binaries:

```toml
[profile.release]
strip = true       # strips symbols (equivalent to -s in Go ldflags)
opt-level = 3
lto = true         # link-time optimization, slower build but smaller/faster binary
codegen-units = 1  # maximizes LTO effectiveness
```

If `strip = true` is set in `Cargo.toml`, do not also run `strip` as a separate step.

### SIGTERM

Tokio handles OS signals via `tokio::signal`. SIGTERM handling **requires explicit wiring in application code** — it is not automatic. The gRPC server must listen for SIGTERM and call shutdown on the tonic `Server`.

Add a comment in the generated Dockerfile:

```dockerfile
# NOTE: This service requires SIGTERM handling in application code.
# Use tokio::signal::unix::signal(SignalKind::terminate()) to listen for
# SIGTERM and trigger graceful server shutdown via tonic Server shutdown hooks.
# Without this, the process receives SIGKILL after the orchestrator grace period.
STOPSIGNAL SIGTERM
```

### gRPC port

gRPC conventionally runs on port 50051. Set via environment variable consistent with the dev Dockerfile:

```dockerfile
ENV GRPC_ADDR="[::]:50051"
EXPOSE 50051
```

The `[::]:50051` binding listens on all IPv4 and IPv6 interfaces — correct for containerised services.

### Healthcheck

Distroless has no shell or curl. For gRPC services, use one of:

1. **gRPC health protocol** (preferred) — implement the standard `grpc.health.v1.Health` service in the application. Use a compiled `grpc_health_probe` binary:
```dockerfile
COPY --from=ghcr.io/grpc-ecosystem/grpc-health-probe:latest /ko-app/grpc-health-probe /bin/grpc_health_probe
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/bin/grpc_health_probe", "-addr=:50051"]
```

2. **Self-contained healthcheck flag** — implement a `-healthcheck` CLI flag in the binary that performs the check and exits 0/1. Reference it in exec-form CMD:
```dockerfile
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/app/server", "-healthcheck"]
```

3. **Separate health HTTP endpoint** — expose a lightweight HTTP `/healthz` on a separate port (e.g. 8080) alongside the gRPC port, and use curl from a sidecar or a compiled minimal binary.

Option 1 is preferred for gRPC services as it validates the gRPC stack end-to-end, not just process liveness.

### Full template

```dockerfile
# syntax=docker/dockerfile:1

# ── Builder ────────────────────────────────────────────────────────────────
FROM rust:1.XX-bookworm AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    protobuf-compiler \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Pass in shared proto directory via BuildKit additional_contexts
COPY --from=root-proto . ./proto

# Manifests + build script (cached layer)
COPY Cargo.toml Cargo.lock ./
COPY build.rs ./

# Stub build — caches dependency compilation
RUN mkdir src && echo 'fn main() {}' > src/main.rs \
    && cargo build --release \
    && rm -f target/release/<binary-name> \
             target/release/<binary-name>.d \
    && rm -rf target/.fingerprint/<binary-name>-* \
    && rm -rf src

# Real build
COPY src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo build --release \
    && cp target/release/<binary-name> /app/server

# ── Runtime ────────────────────────────────────────────────────────────────
FROM gcr.io/distroless/cc-debian12 AS runtime

ARG GIT_SHA=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="<repo-url>"

COPY --from=builder /app/server /app/server

# Optional: copy grpc_health_probe for healthcheck
# COPY --from=ghcr.io/grpc-ecosystem/grpc-health-probe:latest /ko-app/grpc-health-probe /bin/grpc_health_probe

ENV GRPC_ADDR="[::]:50051" \
    RUST_LOG=info

USER nonroot

EXPOSE 50051

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/app/server", "-healthcheck"]

# NOTE: This service requires SIGTERM handling in application code.
# Use tokio::signal::unix::signal(SignalKind::terminate()) and wire it into
# tonic server shutdown. Without it, the process is SIGKILLed after the
# orchestrator grace period with no graceful drain.
STOPSIGNAL SIGTERM

ENTRYPOINT ["/app/server"]
```

### docker-compose integration

The production override must supply the `additional_contexts` for the shared proto directory. This cannot be omitted — without it the build fails at the `COPY --from=root-proto` step.

```yaml
# docker-compose.prod.yml
services:
  <service-name>:
    build:
      context: ./<service-dir>
      dockerfile: Dockerfile
      additional_contexts:
        root-proto: ./proto
    environment:
      RUST_LOG: info
      GRPC_ADDR: "[::]:50051"
    restart: unless-stopped
```

### Hard rules

- Always use `--release` — never ship a debug build
- Always clean stub binary and fingerprint before the real `cargo build`
- Never install `protobuf-compiler` or `libssl-dev` in the runtime stage
- Never use `distroless/static` or `scratch` unless the binary is confirmed musl-linked
- Always preserve the `--from=root-proto` pattern if the project uses a shared proto context
- Always set `RUST_LOG=info` (not `debug`) in production — debug logging is expensive
- Always add the SIGTERM wiring comment
- Healthcheck must not use `curl` or `wget` — distroless has neither