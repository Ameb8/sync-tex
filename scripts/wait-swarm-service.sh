#!/usr/bin/env sh
set -eu

if [ "$#" -lt 2 ]; then
  echo "usage: $0 <stack-name> <service-name> [timeout-seconds]" >&2
  exit 2
fi

STACK_NAME="$1"
SERVICE_NAME="$2"
TIMEOUT_SECONDS="${3:-180}"
SERVICE="${STACK_NAME}_${SERVICE_NAME}"

now_seconds() {
  date +%s
}

print_diagnostics() {
  echo "Service diagnostics for ${SERVICE}:" >&2
  docker service inspect "$SERVICE" >&2 || true
  docker service ps --no-trunc "$SERVICE" >&2 || true
}

desired_replicas() {
  docker service inspect \
    --format '{{if .Spec.Mode.Replicated}}{{.Spec.Mode.Replicated.Replicas}}{{else}}1{{end}}' \
    "$SERVICE"
}

current_task_ids() {
  docker service ps \
    --no-trunc \
    --filter desired-state=running \
    --format '{{.ID}} {{.CurrentState}}' \
    "$SERVICE" | awk '$2 == "Running" { print $1 }'
}

current_task_failures() {
  docker service ps \
    --no-trunc \
    --filter desired-state=running \
    --format '{{.ID}}|{{.CurrentState}}|{{.Error}}' \
    "$SERVICE" | awk -F'|' '$2 ~ /Failed|Rejected/ { print }'
}

container_id_for_task() {
  docker inspect --format '{{.Status.ContainerStatus.ContainerID}}' "$1" 2>/dev/null || true
}

health_status_for_container() {
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$1" 2>/dev/null || true
}

START="$(now_seconds)"
DEADLINE="$((START + TIMEOUT_SECONDS))"

while [ "$(now_seconds)" -lt "$DEADLINE" ]; do
  if ! docker service inspect "$SERVICE" >/dev/null 2>&1; then
    sleep 2
    continue
  fi

  FAILURES="$(current_task_failures)"
  if [ -n "$FAILURES" ]; then
    echo "Service ${SERVICE} has failed or rejected current tasks:" >&2
    echo "$FAILURES" >&2
    print_diagnostics
    exit 1
  fi

  DESIRED="$(desired_replicas)"
  TASK_IDS="$(current_task_ids)"

  set -- $TASK_IDS
  if [ "$#" -ne "$DESIRED" ]; then
    sleep 3
    continue
  fi

  ALL_HEALTHY=1
  for TASK_ID in "$@"; do
    CONTAINER_ID="$(container_id_for_task "$TASK_ID")"
    if [ -z "$CONTAINER_ID" ]; then
      ALL_HEALTHY=0
      break
    fi

    HEALTH_STATUS="$(health_status_for_container "$CONTAINER_ID")"
    case "$HEALTH_STATUS" in
      healthy|none)
        ;;
      starting|"")
        ALL_HEALTHY=0
        break
        ;;
      unhealthy)
        echo "Container ${CONTAINER_ID} for ${SERVICE} is unhealthy." >&2
        print_diagnostics
        exit 1
        ;;
      *)
        ALL_HEALTHY=0
        break
        ;;
    esac
  done

  if [ "$ALL_HEALTHY" -eq 1 ]; then
    echo "Service ${SERVICE} converged with ${DESIRED} replica(s)."
    exit 0
  fi

  sleep 3
done

echo "Timed out waiting for ${SERVICE} to converge after ${TIMEOUT_SECONDS}s." >&2
print_diagnostics
exit 1
