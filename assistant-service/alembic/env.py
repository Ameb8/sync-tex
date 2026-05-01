from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(__file__)))

# Import models
from app.core.database import Base
from app.llm.models import UserLLMKey, UserLLMSettings, LLMUsageLog
from app.auto_context.models import RagIndexState, RagFileIndex, RagChunk, RagRetrievedChunk

config = context.config
fileConfig(config.config_file_name)
target_metadata = Base.metadata

# Override DB URL form env var
config.set_main_option(
    "sqlalchemy.url",
    os.getenv("DATABASE_URL")
)

def run_migrations_offline():
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online():
    connectable = engine_from_config(
        config.get_section(config.config_ini_section),
        prefix='sqlalchemy.',
        poolclass=pool.NullPool
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()