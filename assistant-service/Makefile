# Use docker compose (adjust if you use `docker-compose`)

DC = docker compose
SERVICE = assistant-service

# Default message for migrations

MSG ?= "auto"

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

# Full reset (⚠️ destructive if DB has data)

reset:
$(DC) exec $(SERVICE) alembic downgrade base
$(DC) exec $(SERVICE) alembic upgrade head
