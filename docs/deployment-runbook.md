# Swarm Deployment Runbook

This runbook covers the production Swarm CD path. Local development continues to
use Docker Compose:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

Production uses a single-node Docker Swarm stack:

```sh
docker stack deploy --with-registry-auth --resolve-image always -c docker-compose.swarm.yml synctex
```

## Production Host Prerequisites

- Docker Engine and Docker Compose plugin installed.
- Single-node Swarm initialized.
- Self-hosted GitHub Actions runner installed with labels:
  `self-hosted`, `linux`, `ARM64`, `synctex-prod`.
- Runner user can execute Docker commands.
- Runner has access to this repository checkout.
- A server-local `.env` exists in the checkout or `ENV_FILE` points to it.
- Docker is authenticated to GHCR or the deploy workflow can pass registry auth.

Runtime secrets stay on the production host. Do not add production `.env` files
or secrets to the repository.

## First-Time Production Initialization

Run this section on the production Raspberry Pi, not on a development machine.
The goal is to prepare Docker Swarm, the server-local runtime configuration, the
self-hosted GitHub runner, and the first deployed stack.

### 1. Prepare The Host

Install Docker Engine and the Docker Compose plugin using the official Docker
packages for Debian/Raspberry Pi OS. Confirm the installed tools:

```sh
docker --version
docker compose version
```

Create or choose a non-root deployment user. The GitHub Actions runner should
run as this user, and the user must be able to run Docker commands:

```sh
sudo usermod -aG docker <runner-user>
```

Log out and back in, or restart the runner service after changing group
membership. Validate Docker access as the runner user:

```sh
id
docker ps
```

### 2. Create The Production Checkout

Place the repository somewhere stable, for example:

```sh
mkdir -p /opt/synctex
cd /opt/synctex
git clone https://github.com/ameb8/sync-tex.git .
git checkout main
```

The self-hosted runner should deploy from this checkout or from the checkout it
creates during the workflow. Keep the server-local `.env` beside
`docker-compose.swarm.yml` unless `ENV_FILE` points somewhere else.

### 3. Create The Production `.env`

Start from the example file, then replace every example secret, password, OAuth
credential, API key, and public URL:

```sh
cp .env.example .env
chmod 600 .env
```

Production values must include at least:

- `FRONTEND_URL` and `EXTERNAL_URL` set to the public origin.
- Strong database passwords for all three Postgres services.
- `USERS_SECRET_KEY`, `USERS_INTERNAL_API_KEY`, and
  `PROJECTS_INTERNAL_API_KEY`.
- GitHub OAuth `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.
- MinIO root and application credentials.
- `ASSISTANT_ENCRYPTION_KEY` and provider keys such as `VOYAGE_API_KEY`.
- `REGISTRY_IMAGE_PREFIX=ghcr.io/ameb8/sync-tex`.
- `STACK_NAME=synctex`.
- `SWARM_STACK_FILE=docker-compose.swarm.yml`.

Keep internal service URLs on Swarm service names:

```env
USERS_INTERNAL_API_URL=http://users-service:8001
PROJECTS_SERVICE_URL=http://projects-service:8003
FILE_DATA_ADDR=file-data-service:50051
MINIO_ENDPOINT=minio:9000
```

Do not commit `.env`, copy it into GitHub secrets, or expose it to
GitHub-hosted build jobs.

### 4. Initialize Single-Node Swarm

Initialize Swarm on the Pi:

```sh
docker swarm init
docker node ls
```

Expected result: one node, `Ready`, `Active`, and manager status `Leader`.

This stack uses Swarm for service discovery, rolling updates, and rollback
behavior. Do not run production with `docker compose up` once Swarm CD is the
active deployment path.

### 5. Authenticate Docker To GHCR

The production host needs permission to pull private GHCR images if the package
visibility requires it. Use a GitHub token with package read access:

```sh
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
```

If images are public and the workflow passes registry auth during deploy, this
manual login may not be necessary. It is still useful for manual recovery and
manual deploys.

### 6. Install The Self-Hosted GitHub Runner

In GitHub, create a repository self-hosted runner and follow GitHub's generated
installation commands on the Pi. Configure it with these labels:

```text
self-hosted
linux
ARM64
synctex-prod
```

Install the runner as a systemd service using GitHub's runner service helper,
then start it:

```sh
sudo ./svc.sh install
sudo ./svc.sh start
sudo ./svc.sh status
```

Validate the runner user can read the production checkout and run Docker:

```sh
cd /opt/synctex
test -f docker-compose.swarm.yml
test -f .env
docker stack ls
```

The self-hosted runner is for deployment only. Build jobs must run on
GitHub-hosted `ubuntu-latest` runners.

### 7. Ensure Initial Images Exist

Before the first stack deploy, GHCR must contain ARM64 images tagged `latest`
for:

- `users-service`
- `projects-service`
- `collab-service`
- `file-data-service`
- `assistant-service`
- `nginx`

The normal way to create them is to run the `Deploy` workflow manually with
`build_all=true`. That builds every image on GitHub-hosted runners and then
deploys from the self-hosted runner.

If you need a manual image bootstrap before enabling the runner, build and push
each image from a machine with Buildx:

```sh
docker buildx build \
  --platform linux/arm64 \
  -t ghcr.io/ameb8/sync-tex/users-service:latest \
  --push \
  users-service
```

Repeat for each deployable image. `file-data-service` needs the root proto
additional build context, so prefer the GitHub workflow for the first full
image bootstrap.

### 8. Run The First Deploy

From the production checkout, run:

```sh
cd /opt/synctex
scripts/deploy-stack.sh
```

On a fresh host, the script performs a bootstrap sequence:

1. Deploys the stack once so Swarm creates the overlay network and database
   services.
2. Waits for `postgres-users`, `postgres-projects`, `postgres-assistant`, and
   `minio`.
3. Runs `projects-service` migrations.
4. Runs `assistant-service` Alembic migrations.
5. Deploys the stack again.
6. Waits for all app services, nginx, and cloudflared to converge.

If the first deploy fails, inspect task errors before retrying:

```sh
docker stack services synctex
docker stack ps synctex --no-trunc
docker service logs synctex_projects-service
```

Do not delete volumes during troubleshooting unless you intentionally want to
discard production data.

### 9. Validate The First Deploy

From the Pi:

```sh
docker stack services synctex
docker stack ps synctex
curl -fsS http://127.0.0.1/health
```

Then validate the public route through cloudflared:

- GitHub OAuth login and redirect.
- Authenticated project listing.
- File upload/download through presigned MinIO URLs.
- Collaboration WebSocket connect and reconnect.
- Assistant SSE streaming under `/api/llm/v1/`.

After manual validation passes, future pushes to `main` can use the CD workflow.

## Required Images

The CD workflow builds and pushes these ARM64 images to GHCR:

- `users-service`
- `projects-service`
- `collab-service`
- `file-data-service`
- `assistant-service`
- `nginx`

Each image is tagged as both `latest` and the commit SHA. The first rollout uses
`latest` in `docker-compose.swarm.yml` and forces Swarm to resolve the latest
registry digest on every deploy.

## Manual Deploy

From the production checkout:

```sh
scripts/deploy-stack.sh
```

The script:

- loads `.env`
- runs service migrations when the Swarm network exists
- deploys `docker-compose.swarm.yml`
- waits for stateful services, app services, nginx, and cloudflared to converge

For the first bootstrap, the script deploys the stack once to create the Swarm
network and databases, waits for stateful services, runs migrations, then
redeploys and waits for the full stack.

## Migrations

`scripts/deploy-stack.sh` runs:

- `projects-service` migrations with `migrate/migrate:4`
- `assistant-service` Alembic migrations with the deployed assistant image

Disable automatic migrations only for a deliberate manual recovery:

```sh
RUN_MIGRATIONS=false scripts/deploy-stack.sh
```

Schema migrations must remain backward-compatible with the currently running
tasks during Swarm rolling updates.

## Health And Verification

Inspect stack state:

```sh
docker stack services synctex
docker stack ps synctex
```

Check gateway health from the production host:

```sh
curl -fsS http://127.0.0.1/health
```

Service convergence is checked by:

```sh
scripts/wait-swarm-service.sh synctex projects-service 180
```

For services with Docker healthchecks, the wait script requires healthy
containers. For services without healthchecks, running tasks are accepted.

## Rollback

Automatic rollback is configured in the Swarm deploy policy for application
services. Manual service rollback:

```sh
docker service rollback synctex_projects-service
```

Database rollback is not automatic. Any non-backward-compatible migration needs
a service-specific recovery plan before deployment.

## Legacy Compose Production

`docker-compose.prod.yml` remains available while the Swarm path is being
validated. New CD work should target `docker-compose.swarm.yml`.
