"""findings at a commit

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-15 14:20:31.502117
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RAISED_BY_A_SCAN = "fingerprint IS NOT NULL"


def upgrade() -> None:
    # Nothing has written a finding before this revision, so there is no row
    # to give a commit to.
    op.add_column("security_findings", sa.Column("commit", sa.Text(), nullable=False))
    op.add_column("security_findings", sa.Column("rule", sa.Text(), nullable=True))
    op.add_column(
        "security_findings", sa.Column("fingerprint", sa.Text(), nullable=True)
    )
    op.add_column(
        "security_findings", sa.Column("fixed_commit", sa.Text(), nullable=True)
    )
    op.create_index(
        "ix_security_findings_fingerprint",
        "security_findings",
        ["repository_id", "fingerprint"],
        unique=True,
        postgresql_where=sa.text(RAISED_BY_A_SCAN),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_security_findings_fingerprint",
        table_name="security_findings",
        postgresql_where=sa.text(RAISED_BY_A_SCAN),
    )
    op.drop_column("security_findings", "fixed_commit")
    op.drop_column("security_findings", "fingerprint")
    op.drop_column("security_findings", "rule")
    op.drop_column("security_findings", "commit")
