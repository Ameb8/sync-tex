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
- Cloudflare owns `sync-tex.com` and `cloudflared` is installed on the
  production host.
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
git checkout master
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

- `FRONTEND_URL=https://sync-tex.com`.
- `EXTERNAL_URL=https://sync-tex.com`.
- Strong database passwords for all three Postgres services.
- `USERS_SECRET_KEY`, `USERS_INTERNAL_API_KEY`, and
  `PROJECTS_INTERNAL_API_KEY`.
- GitHub OAuth `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.
- Google OAuth `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
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

Keep browser-facing MinIO URLs on the public HTTPS origin:

```env
MINIO_EXTERNAL_ENDPOINT=https://sync-tex.com/minio/api
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

### 6. Create The Named Cloudflare Tunnel

Create the named tunnel once on the production Pi. This can be run from any
directory; `cloudflared` writes the credentials JSON under the home directory
of the user running the command.

```sh
cloudflared tunnel login
cloudflared tunnel create synctex
```

Record the tunnel UUID from the command output. The UUID is not a secret, but
the generated credentials JSON is a secret. The credentials file is normally:

```text
~/.cloudflared/<tunnel-uuid>.json
```

Before deploying, the repository version of these files must contain the real
UUID, not `<tunnel-id>`:

- `cloudflared/config.yml`
- `docker-compose.swarm.yml`, in the `cloudflared_creds` secret target path

The committed config should look like this, with the real UUID in both paths:

```yaml
tunnel: <tunnel-uuid>
credentials-file: /etc/cloudflared/<tunnel-uuid>.json

ingress:
  - hostname: sync-tex.com
    service: http://nginx:80
  - service: http_status:404
```

Create the DNS route in Cloudflare:

```sh
cloudflared tunnel route dns synctex sync-tex.com
```

The stack uses externally managed Swarm objects for the tunnel config and
credentials. Create them before the first deploy from the production checkout:

```sh
cd /opt/synctex
docker config create cloudflared_config ./cloudflared/config.yml
docker secret create cloudflared_creds ~/.cloudflared/<tunnel-uuid>.json
```

Validate that both objects exist:

```sh
docker config ls | grep cloudflared_config
docker secret ls | grep cloudflared_creds
```

Do not commit the credentials JSON, copy it into `.env`, or store it in GitHub
secrets. Only the UUID and `cloudflared/config.yml` are tracked.

### 7. Install The Self-Hosted GitHub Runner

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

### 8. Ensure Initial Images Exist

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

### 9. Run The First Deploy

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
docker service logs synctex_cloudflared
```

Do not delete volumes during troubleshooting unless you intentionally want to
discard production data.

The Google OAuth identity-table rollout is a fresh-schema cutover. The current
users-service uses `oauth_identities` and `oauth_states` tables and does not
read the legacy `users.oauth_provider` / `users.oauth_id` columns. For that
deployment, intentionally wipe/recreate the users-service database volume before
validating OAuth sign-in.

### 10. Validate The First Deploy

From the Pi:

```sh
docker stack services synctex
docker stack ps synctex
```

Then validate the public route through cloudflared:

- Gateway health:
  `curl -fsS https://sync-tex.com/health`
- GitHub OAuth login and redirect.
- Authenticated project listing.
- File upload/download through presigned MinIO URLs.
- Collaboration WebSocket connect and reconnect.
- Assistant SSE streaming under `/api/llm/v1/`.

After manual validation passes, future pushes to `master` can use the CD workflow.

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

The deploy script does not create or update the external Swarm objects used by
`cloudflared`. `cloudflared_config` and `cloudflared_creds` must already exist
before `scripts/deploy-stack.sh` runs.

## Cloudflare Tunnel Management

The named tunnel has three separate pieces:

- Cloudflare tunnel identity: the UUID created by `cloudflared tunnel create`.
- Swarm config: `cloudflared_config`, created from `cloudflared/config.yml`.
- Swarm secret: `cloudflared_creds`, created from
  `~/.cloudflared/<tunnel-uuid>.json`.

The UUID is safe to track in Git. The credentials JSON is secret and must stay
on the production host only.

### Inspect Current State

Run these commands on the production Pi:

```sh
cloudflared tunnel list
docker config ls | grep cloudflared_config
docker secret ls | grep cloudflared_creds
docker service logs synctex_cloudflared --tail 100
```

To inspect the deployed config content:

```sh
docker config inspect cloudflared_config --pretty
```

### Updating `cloudflared/config.yml`

Swarm configs are immutable. If `cloudflared/config.yml` changes in Git, a
normal `git pull` and `scripts/deploy-stack.sh` is not enough; the external
Docker config must be recreated.

Because the current stack references the fixed external name
`cloudflared_config`, recreate it during a planned maintenance window:

```sh
cd /opt/synctex
docker stack rm synctex

until [ -z "$(docker stack ps synctex 2>/dev/null)" ]; do
  sleep 2
done

docker config rm cloudflared_config
docker config create cloudflared_config ./cloudflared/config.yml
scripts/deploy-stack.sh
```

Use this flow for ingress rule changes, hostname changes, or a changed tunnel
UUID in `cloudflared/config.yml`.

### Rotating Tunnel Credentials

If the tunnel credentials JSON changes but the tunnel UUID remains the same,
recreate the Swarm secret during a planned maintenance window:

```sh
cd /opt/synctex
docker stack rm synctex

until [ -z "$(docker stack ps synctex 2>/dev/null)" ]; do
  sleep 2
done

docker secret rm cloudflared_creds
docker secret create cloudflared_creds ~/.cloudflared/<tunnel-uuid>.json
scripts/deploy-stack.sh
```

If creating a completely new tunnel, update the UUID in Git first, merge the
change, pull it on the Pi, recreate both `cloudflared_config` and
`cloudflared_creds`, then redeploy.

### DNS And OAuth

The DNS route should point the apex hostname at the named tunnel:

```sh
cloudflared tunnel route dns synctex sync-tex.com
```

The GitHub and Google OAuth app callback URLs must match the public origin:

```text
https://sync-tex.com/auth/github/callback
https://sync-tex.com/auth/google/callback
```

After any domain or tunnel change, validate:

```sh
curl -fsS https://sync-tex.com/health
docker service logs synctex_cloudflared --tail 100
```

If `cloudflared` logs a permission error when reading the credentials file,
confirm the `cloudflared_creds` secret mount in `docker-compose.swarm.yml` uses
mode `0444`. Recent `cloudflare/cloudflared` images run as a non-root user, so
a root-only `0400` secret mount can make the tunnel credentials unreadable even
though the Swarm secret exists.

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
curl -fsS https://sync-tex.com/health
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
