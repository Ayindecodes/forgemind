"""Tasks, their runs, and the record of what each run did.

The execution event log is the source of truth. A run row carries the state
folded from its events so lists and pages do not replay the log; the fold is
the contract's reduceRun, and the row is rewritten from the events whenever
one is appended.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from forgemind_api.models.base import Base, IdMixin, TimestampsMixin, enum

TASK_CATEGORIES = (
    "investigate",
    "fix_bug",
    "add_tests",
    "security",
    "dependencies",
    "refactor",
    "docs",
    "validation",
)
TASK_STATUSES = (
    "queued",
    "running",
    "awaiting_approval",
    "completed",
    "cancelled",
    "failed",
)
DECISIONS = ("approved", "rejected", "revision_requested")
RUN_STATUSES = ("queued", "running", "awaiting_approval", "completed", "cancelled")
OUTCOMES = ("succeeded", "partial", "failed", "unverified")
VERIFICATIONS = ("pending", "verified", "failed", "unverified")
STAGES = (
    "inspection",
    "planning",
    "implementation",
    "testing",
    "review",
    "verification",
    "approval",
)
STAGE_STATUSES = ("pending", "running", "passed", "failed", "skipped")
AGENT_TYPES = (
    "orchestrator",
    "architect",
    "developer",
    "testing",
    "security",
    "review",
    "release",
)
CHECK_KINDS = ("tests", "build", "lint", "typecheck", "security_scan")
CHECK_STATUSES = ("not_run", "running", "passed", "failed", "error", "skipped")
ARTIFACT_KINDS = ("patch", "diff", "log", "check_output", "report")


class Task(IdMixin, TimestampsMixin, Base):
    __tablename__ = "tasks"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    repository_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("repositories.id", ondelete="RESTRICT"), nullable=False
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    request: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(
        enum("task_category", *TASK_CATEGORIES), nullable=False
    )
    base_commit: Mapped[str] = mapped_column(Text, nullable=False)
    branch: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        enum("task_status", *TASK_STATUSES), nullable=False, default="queued"
    )
    decision: Mapped[str | None] = mapped_column(enum("task_decision", *DECISIONS))
    # The run that currently counts for this task; earlier runs stay in `runs`.
    current_run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("runs.id", ondelete="SET NULL", use_alter=True)
    )
    budget_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    budget_retries: Mapped[int] = mapped_column(Integer, nullable=False)
    budget_tokens: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    __table_args__ = (
        Index("ix_tasks_organization_id_updated_at", "organization_id", "updated_at"),
        Index("ix_tasks_repository_id", "repository_id"),
    )


class Run(IdMixin, TimestampsMixin, Base):
    __tablename__ = "runs"

    task_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(
        enum("run_status", *RUN_STATUSES), nullable=False, default="queued"
    )
    outcome: Mapped[str | None] = mapped_column(enum("run_outcome", *OUTCOMES))
    verification: Mapped[str] = mapped_column(
        enum("run_verification", *VERIFICATIONS), nullable=False, default="pending"
    )
    expects_patch: Mapped[bool] = mapped_column(Boolean, nullable=False)
    base_commit: Mapped[str] = mapped_column(Text, nullable=False)
    branch: Mapped[str | None] = mapped_column(Text)
    retries_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    retries_max: Mapped[int] = mapped_column(Integer, nullable=False)
    last_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(Text)
    # The folded view: stages, checks, diff, review, resources, active agent.
    state: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        UniqueConstraint("task_id", "number"),
        Index("ix_runs_organization_id_started_at", "organization_id", "started_at"),
    )


class ExecutionEvent(IdMixin, Base):
    """One thing that happened in a run, in order. Append-only."""

    __tablename__ = "execution_events"

    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"), nullable=False
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)

    __table_args__ = (UniqueConstraint("run_id", "seq"),)


class AgentRun(IdMixin, Base):
    """One agent's attempt at one stage of a run."""

    __tablename__ = "agent_runs"

    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"), nullable=False
    )
    stage: Mapped[str] = mapped_column(enum("agent_run_stage", *STAGES), nullable=False)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False)
    agent_type: Mapped[str] = mapped_column(
        enum("agent_type", *AGENT_TYPES), nullable=False
    )
    status: Mapped[str] = mapped_column(
        enum("agent_run_status", *STAGE_STATUSES), nullable=False, default="pending"
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    summary: Mapped[str | None] = mapped_column(Text)
    failure_reason: Mapped[str | None] = mapped_column(Text)
    input_ref: Mapped[str | None] = mapped_column(Text)
    output_ref: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (UniqueConstraint("run_id", "stage", "attempt"),)


class Artifact(IdMixin, Base):
    __tablename__ = "artifacts"

    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"), nullable=False
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(
        enum("artifact_kind", *ARTIFACT_KINDS), nullable=False
    )
    storage_ref: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    __table_args__ = (Index("ix_artifacts_run_id", "run_id"),)


class VerificationResult(IdMixin, Base):
    """One deterministic check run against one attempt."""

    __tablename__ = "verification_results"

    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"), nullable=False
    )
    attempt: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(enum("check_kind", *CHECK_KINDS), nullable=False)
    label: Mapped[str] = mapped_column(Text, nullable=False)
    command: Mapped[str] = mapped_column(Text, nullable=False)
    required: Mapped[bool] = mapped_column(Boolean, nullable=False)
    status: Mapped[str] = mapped_column(
        enum("check_status", *CHECK_STATUSES), nullable=False, default="not_run"
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    summary: Mapped[str | None] = mapped_column(Text)
    # { passed, failed, skipped } when the tool reports counts.
    counts: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    output_artifact_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("artifacts.id", ondelete="SET NULL")
    )

    __table_args__ = (
        Index("ix_verification_results_run_id_attempt", "run_id", "attempt"),
    )


class PullRequest(IdMixin, TimestampsMixin, Base):
    __tablename__ = "pull_requests"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"), nullable=False
    )
    repository_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False
    )
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    branch: Mapped[str] = mapped_column(Text, nullable=False)
    state: Mapped[str] = mapped_column(
        enum("pull_request_state", "open", "merged", "closed"), nullable=False
    )
    review_status: Mapped[str] = mapped_column(
        enum("pull_request_review", "pending", "approved", "changes_requested"),
        nullable=False,
    )
    checks_status: Mapped[str] = mapped_column(
        enum("pull_request_checks", "pending", "passed", "failed"), nullable=False
    )
    merged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        UniqueConstraint("repository_id", "number"),
        Index("ix_pull_requests_organization_id", "organization_id"),
    )
