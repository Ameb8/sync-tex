# syntax=docker/dockerfile:1

# Build the Vite frontend in a disposable Node stage. The final nginx image
# only receives the compiled static files.
FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS builder
WORKDIR /app

# Copy dependency manifests first so Docker can reuse the npm install layer
# when only frontend source files change.
COPY frontend/package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY frontend ./
RUN npm run build

# Runtime gateway image: nginx config plus the compiled frontend assets. No
# frontend source, node_modules, or build tooling is copied into this stage.
FROM nginx:1.27-alpine3.21-slim@sha256:b947b2630c97622793113555e13332eec85bdc7a0ac6ab697159af78942bb856 AS runtime
WORKDIR /usr/share/nginx/html

# Build metadata is optional and safe to omit; Compose defaults these args to
# "unknown" when they are not supplied by the deployment environment.
ARG GIT_SHA=unknown
ARG BUILD_DATE=unknown
LABEL org.opencontainers.image.title="sync-tex-nginx" \
      org.opencontainers.image.description="SyncTeX nginx gateway with compiled frontend assets" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="sync-tex"

COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/conf.d/frontend.conf /etc/nginx/conf.d/frontend.conf

# Vite writes index.html and hashed assets under /app/dist.
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

# Validate the same gateway health route exposed by nginx/conf.d/default.conf.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O - http://127.0.0.1/health || exit 1

STOPSIGNAL SIGTERM

# Keep nginx in the foreground so Docker can supervise the process.
CMD ["nginx", "-g", "daemon off;"]
