"""Notifications, the audit trail and usage accounting."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from forgemind_api.models.base import Base, IdMixin, enum

NOTIFICATION_KINDS = (
    "task_awaiting_approval",
    "task_failed",
    "task_completed",
    "finding_detected",
    "pull_request_updated",
    "member_joined",
)
USAGE_KINDS = (
    "tokens",
    "sandbox_seconds",
    "cpu_seconds",
    "memory_mb_hours",
    "storage_bytes",
    "retry_overhead_seconds",
)
COST_KINDS = ("actual", "estimate", "unavailable")


class Notification(IdMixin, Base):
    __tablename__ = "notifications"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    # Null means everyone in the organization.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE")
    )
    kind: Mapped[str] = mapped_column(
        enum("notification_kind", *NOTIFICATION_KINDS), nullable=False
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    href: Mapped[str | None] = mapped_column(Text)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index(
            "ix_notifications_organization_id_created_at",
            "organization_id",
            "created_at",
        ),
    )


class AuditEvent(IdMixin, Base):
    """A consequential action, who did it, and what it was done to."""

    __tablename__ = "audit_events"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    actor_name: Mapped[str] = mapped_column(Text, nullable=False)
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    target_type: Mapped[str] = mapped_column(String(40), nullable=False)
    target_id: Mapped[str] = mapped_column(Text, nullable=False)
    target_label: Mapped[str] = mapped_column(Text, nullable=False, default="")
    details: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_audit_events_organization_id_at", "organization_id", "at"),
    )


class UsageRecord(IdMixin, Base):
    """One measured quantity, attributed to a run when there is one."""

    __tablename__ = "usage_records"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("runs.id", ondelete="SET NULL")
    )
    kind: Mapped[str] = mapped_column(enum("usage_kind", *USAGE_KINDS), nullable=False)
    provider: Mapped[str | None] = mapped_column(String(40))
    model: Mapped[str | None] = mapped_column(String(80))
    quantity: Mapped[Decimal] = mapped_column(Numeric(20, 4), nullable=False)
    # For tokens: input or output. Other kinds leave it null.
    direction: Mapped[str | None] = mapped_column(
        enum("usage_direction", "input", "output")
    )
    cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(14, 6))
    cost_kind: Mapped[str | None] = mapped_column(enum("usage_cost_kind", *COST_KINDS))
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index(
            "ix_usage_records_organization_id_recorded_at",
            "organization_id",
            "recorded_at",
        ),
    )
