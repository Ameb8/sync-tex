"""Add custom base URL to LLM provider credentials.

Revision ID: f4c8a91e2d73
Revises: 993e2d76e758
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f4c8a91e2d73"
down_revision: Union[str, Sequence[str], None] = "993e2d76e758"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("user_llm_keys", sa.Column("base_url", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("user_llm_keys", "base_url")
