#!/usr/bin/env sh
set -eu

ENV_FILE="${ENV_FILE:-.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing environment file: ${ENV_FILE}" >&2
  exit 1
fi

set -a
case "$ENV_FILE" in
  */*) . "$ENV_FILE" ;;
  *) . "./$ENV_FILE" ;;
esac
set +a

STACK_NAME="${STACK_NAME:-synctex}"
STACK_FILE="${SWARM_STACK_FILE:-docker-compose.swarm.yml}"
WAIT_TIMEOUT_SECONDS="${WAIT_TIMEOUT_SECONDS:-180}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-true}"
MIGRATE_IMAGE="${MIGRATE_IMAGE:-migrate/migrate:4}"
REGISTRY_IMAGE_PREFIX="${REGISTRY_IMAGE_PREFIX:-ghcr.io/ameb8/sync-tex}"

STATEFUL_SERVICES="${STATEFUL_SERVICES:-postgres-users postgres-projects postgres-assistant minio}"
APP_SERVICES="${APP_SERVICES:-users-service projects-service collab-service file-data-service assistant-service nginx cloudflared}"
NETWORK_NAME="${STACK_NAME}_gateway-network"

if [ ! -f "$STACK_FILE" ]; then
  echo "Missing Swarm stack file: ${STACK_FILE}" >&2
  exit 1
fi

require_var() {
  eval "VALUE=\${$1:-}"
  if [ -z "$VALUE" ]; then
    echo "Missing required environment variable: $1" >&2
    exit 1
  fi
}

database_url_with_sslmode_disabled() {
  case "$1" in
    *sslmode=*)
      printf '%s\n' "$1"
      ;;
    *\?*)
      printf '%s&sslmode=disable\n' "$1"
      ;;
    *)
      printf '%s?sslmode=disable\n' "$1"
      ;;
  esac
}

deploy_stack() {
  docker stack deploy \
    --with-registry-auth \
    --resolve-image always \
    -c "$STACK_FILE" \
    "$STACK_NAME"
}

wait_for_services() {
  for SERVICE in "$@"; do
    scripts/wait-swarm-service.sh "$STACK_NAME" "$SERVICE" "$WAIT_TIMEOUT_SECONDS"
  done
}

wait_for_service_list() {
  for SERVICE in $1; do
    scripts/wait-swarm-service.sh "$STACK_NAME" "$SERVICE" "$WAIT_TIMEOUT_SECONDS"
  done
}

swarm_network_exists() {
  docker network inspect "$NETWORK_NAME" >/dev/null 2>&1
}

run_projects_migrations() {
  require_var PROJECTS_DB_URL

  PROJECTS_MIGRATION_URL="$(database_url_with_sslmode_disabled "$PROJECTS_DB_URL")"
  echo "Running projects-service migrations."
  docker run --rm \
    --network "$NETWORK_NAME" \
    -v "$(pwd)/projects-service/db/migrations:/migrations:ro" \
    "$MIGRATE_IMAGE" \
    -path=/migrations \
    -database "$PROJECTS_MIGRATION_URL" \
    up
}

run_assistant_migrations() {
  require_var REGISTRY_IMAGE_PREFIX
  require_var ASSISTANT_DB_URL
  require_var ASSISTANT_DB_SYNC_URL

  ASSISTANT_IMAGE="${REGISTRY_IMAGE_PREFIX}/assistant-service:${ASSISTANT_SERVICE_TAG:-latest}"
  echo "Running assistant-service migrations with ${ASSISTANT_IMAGE}."
  docker run --rm \
    --network "$NETWORK_NAME" \
    -e DATABASE_URL="$ASSISTANT_DB_URL" \
    -e DATABASE_SYNC_URL="$ASSISTANT_DB_SYNC_URL" \
    "$ASSISTANT_IMAGE" \
    alembic upgrade head
}

run_migrations() {
  if [ "$RUN_MIGRATIONS" != "true" ]; then
    echo "Skipping migrations because RUN_MIGRATIONS=${RUN_MIGRATIONS}."
    return
  fi

  if ! swarm_network_exists; then
    echo "Skipping migrations because ${NETWORK_NAME} does not exist yet."
    return
  fi

  run_projects_migrations
  run_assistant_migrations
}

POST_BOOTSTRAP_MIGRATIONS=false
if ! swarm_network_exists; then
  POST_BOOTSTRAP_MIGRATIONS=true
fi

if [ "$POST_BOOTSTRAP_MIGRATIONS" = false ]; then
  run_migrations
fi

deploy_stack
wait_for_service_list "$STATEFUL_SERVICES"

if [ "$POST_BOOTSTRAP_MIGRATIONS" = true ]; then
  run_migrations
  deploy_stack
fi

wait_for_service_list "$STATEFUL_SERVICES $APP_SERVICES"
