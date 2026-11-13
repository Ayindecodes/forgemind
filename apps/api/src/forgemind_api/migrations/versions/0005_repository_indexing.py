"""repository indexing

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-13 10:26:11.402857
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "repositories",
        sa.Column("index_attempts", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "repositories",
        sa.Column("index_dispatched_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "repositories", sa.Column("index_worker_id", sa.Text(), nullable=True)
    )
    op.add_column(
        "repositories",
        sa.Column("index_heartbeat_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_repositories_analyzing",
        "repositories",
        ["index_heartbeat_at"],
        unique=False,
        postgresql_where=sa.text("status = 'analyzing'"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_repositories_analyzing",
        table_name="repositories",
        postgresql_where=sa.text("status = 'analyzing'"),
    )
    op.drop_column("repositories", "index_heartbeat_at")
    op.drop_column("repositories", "index_worker_id")
    op.drop_column("repositories", "index_dispatched_at")
    op.drop_column("repositories", "index_attempts")
