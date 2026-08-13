"""Añade rules.name (nombre legible para la UI).

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ADD COLUMN simple: soportado nativamente por SQLite, no necesita batch
    op.add_column("rules", sa.Column("name", sa.String(length=120), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("rules") as batch_op:
        batch_op.drop_column("name")
