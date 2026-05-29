DC ?= docker compose -f ../docker-compose.yml -f ../docker-compose.dev.yml
SERVICE = assistant-service

VENV ?= .venv
VENV_PYTHON ?= python3
VENV_BIN = $(VENV)/bin
PIP = $(VENV_BIN)/python -m pip
PYTEST = $(VENV_BIN)/python -m pytest

# Default message for migrations

MSG ?= "auto"

.PHONY: install-dev test test-cov test-container test-container-build exec migrate upgrade downgrade current history stamp reset

$(VENV_BIN)/python:
	$(VENV_PYTHON) -m venv $(VENV)

$(VENV)/.deps: requirements.txt requirements-dev.txt | $(VENV_BIN)/python
	$(PIP) install --upgrade pip
	$(PIP) install -r requirements-dev.txt
	touch $(VENV)/.deps

install-dev: $(VENV)/.deps

# Run Tests --- --- --- --- --- --- 

# Local PyTest
test: $(VENV)/.deps
	$(PYTEST)

# Local coverage check
test-cov: $(VENV)/.deps
	$(PYTEST) --cov=app --cov-report=term-missing

# Container test
test-container:
	$(DC) run --rm $(SERVICE) python -m pytest

# Container build and test
test-container-build:
	$(DC) build $(SERVICE)
	$(DC) run --rm $(SERVICE) python -m pytest

# Run a command inside the assistant service container
exec:
	$(DC) exec $(SERVICE) sh

# Create a new migration (autogenerate from models)
migrate:
	$(DC) exec $(SERVICE) alembic revision --autogenerate -m $(MSG)

# Apply all migrations
upgrade:
	$(DC) exec $(SERVICE) alembic upgrade head

# Rollback last migration
downgrade:
	$(DC) exec $(SERVICE) alembic downgrade -1

# Show current revision
current:
	$(DC) exec $(SERVICE) alembic current

# Show migration history
history:
	$(DC) exec $(SERVICE) alembic history

# Stamp DB (mark as up-to-date without running migrations)
stamp:
	$(DC) exec $(SERVICE) alembic stamp head

# Full reset (destructive if DB has data)
reset:
	$(DC) exec $(SERVICE) alembic downgrade base
	$(DC) exec $(SERVICE) alembic upgrade head
