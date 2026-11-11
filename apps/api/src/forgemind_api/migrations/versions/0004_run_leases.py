"""run leases

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-11 09:12:40.118204
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("runs", sa.Column("worker_id", sa.Text(), nullable=True))
    op.add_column(
        "runs", sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "runs",
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "runs", sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_index(
        "ix_runs_unfinished",
        "runs",
        ["status", "heartbeat_at"],
        unique=False,
        postgresql_where=sa.text("status IN ('queued', 'running')"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_runs_unfinished",
        table_name="runs",
        postgresql_where=sa.text("status IN ('queued', 'running')"),
    )
    op.drop_column("runs", "dispatched_at")
    op.drop_column("runs", "attempts")
    op.drop_column("runs", "heartbeat_at")
    op.drop_column("runs", "worker_id")
