DOCKER_COMPOSE ?= docker compose
ENV ?= dev
SERVICE ?=
CMD ?= sh
LOGS_ARGS ?= -f --tail=100

# Keep target lists centralized so .PHONY declarations and env wrappers do not drift.
ENVS := dev prod
BASE_TARGETS := up build rebuild down stop restart ps logs config pull exec run shell reset
ENV_TARGETS := up build rebuild down stop restart ps logs config pull reset
SERVICE_ENV_TARGETS := up build rebuild stop restart pull
PLAIN_ENV_TARGETS := down ps config reset
LOG_ENV_TARGETS := logs

BASE_COMPOSE := -f docker-compose.yml

# Fail at parse time for unsupported environments instead of passing a bad file to Docker.
ifeq ($(filter $(ENV),$(ENVS)),)
$(error ENV must be either dev or prod)
endif

# Recursive assignment lets target-specific ENV values resolve at recipe execution time.
COMPOSE_FILES = $(BASE_COMPOSE) -f docker-compose.$(ENV).yml
DC = $(DOCKER_COMPOSE) $(COMPOSE_FILES)

.DEFAULT_GOAL := help

.PHONY: help require-service $(BASE_TARGETS) \
	$(foreach env,$(ENVS),$(env) $(addprefix $(env)-,$(ENV_TARGETS)))

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*##"; printf "Usage: make <target> [ENV=dev|prod] [SERVICE=name] [CMD=cmd]\n\nTargets:\n"} /^[a-zA-Z0-9_-]+:.*##/ {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

up: ## Start the selected environment in the background
	$(DC) up -d $(SERVICE)

build: ## Build images for the selected environment
	$(DC) build $(SERVICE)

rebuild: ## Build images without cache, then start containers
	$(DC) build --no-cache $(SERVICE)
	$(DC) up -d $(SERVICE)

down: ## Stop and remove containers for the selected environment
	$(DC) down --remove-orphans

stop: ## Stop containers without removing them
	$(DC) stop $(SERVICE)

restart: ## Restart containers
	$(DC) restart $(SERVICE)

ps: ## List containers
	$(DC) ps

logs: ## Follow logs; optionally set SERVICE=name
	$(DC) logs $(LOGS_ARGS) $(SERVICE)

config: ## Render the merged compose configuration
	$(DC) config

pull: ## Pull images referenced by the selected environment
	$(DC) pull $(SERVICE)

exec: require-service ## Execute CMD in a running service container
	$(DC) exec $(SERVICE) $(CMD)

run: require-service ## Run CMD in a one-off service container
	$(DC) run --rm $(SERVICE) $(CMD)

shell: require-service ## Open a shell in a running service container
	$(DC) exec $(SERVICE) sh

reset: ## Remove containers, networks, and volumes for the selected environment
	$(DC) down --volumes --remove-orphans

dev: dev-up ## Start the dev environment
dev-up: ## Start the dev environment
dev-build: ## Build dev images
dev-rebuild: ## Rebuild dev images without cache, then start containers
dev-down: ## Stop and remove dev containers
dev-stop: ## Stop dev containers without removing them
dev-restart: ## Restart dev containers
dev-ps: ## List dev containers
dev-logs: ## Follow dev logs; optionally set SERVICE=name
dev-config: ## Render the merged dev compose configuration
dev-pull: ## Pull dev images
dev-reset: ## Remove dev containers, networks, and volumes

# Static pattern wrappers preserve explicit help entries while sharing forwarding logic.
$(addprefix dev-,$(SERVICE_ENV_TARGETS)): dev-%:
	$(MAKE) $* ENV=dev SERVICE="$(SERVICE)"

$(addprefix dev-,$(PLAIN_ENV_TARGETS)): dev-%:
	$(MAKE) $* ENV=dev

$(addprefix dev-,$(LOG_ENV_TARGETS)): dev-%:
	$(MAKE) $* ENV=dev SERVICE="$(SERVICE)" LOGS_ARGS="$(LOGS_ARGS)"

prod: prod-up ## Start the prod environment
prod-up: ## Start the prod environment
prod-build: ## Build prod images
prod-rebuild: ## Rebuild prod images without cache, then start containers
prod-down: ## Stop and remove prod containers
prod-stop: ## Stop prod containers without removing them
prod-restart: ## Restart prod containers
prod-ps: ## List prod containers
prod-logs: ## Follow prod logs; optionally set SERVICE=name
prod-config: ## Render the merged prod compose configuration
prod-pull: ## Pull prod images
prod-reset: ## Remove prod containers, networks, and volumes

# Keep these split by argument shape so dry-runs match the explicit wrappers.
$(addprefix prod-,$(SERVICE_ENV_TARGETS)): prod-%:
	$(MAKE) $* ENV=prod SERVICE="$(SERVICE)"

$(addprefix prod-,$(PLAIN_ENV_TARGETS)): prod-%:
	$(MAKE) $* ENV=prod

$(addprefix prod-,$(LOG_ENV_TARGETS)): prod-%:
	$(MAKE) $* ENV=prod SERVICE="$(SERVICE)" LOGS_ARGS="$(LOGS_ARGS)"

require-service:
	@test -n "$(SERVICE)" || (echo "Set SERVICE=<service-name>, for example: make shell SERVICE=users-service" >&2; exit 1)
