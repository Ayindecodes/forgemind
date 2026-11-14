"""usage ledger

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-14 09:12:40.118204
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TIED_TO_AN_EVENT = "run_id IS NOT NULL AND event_seq IS NOT NULL"


def upgrade() -> None:
    op.add_column("usage_records", sa.Column("event_seq", sa.Integer(), nullable=True))
    op.create_index(
        "ix_usage_records_event",
        "usage_records",
        ["run_id", "event_seq", "kind", "direction"],
        unique=True,
        postgresql_nulls_not_distinct=True,
        postgresql_where=sa.text(TIED_TO_AN_EVENT),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_usage_records_event",
        table_name="usage_records",
        postgresql_nulls_not_distinct=True,
        postgresql_where=sa.text(TIED_TO_AN_EVENT),
    )
    op.drop_column("usage_records", "event_seq")
