"""Repository connections, their analyses and the findings raised on them."""

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

CONNECTION_STATUSES = ("connected", "analyzing", "error", "revoked")
SEVERITIES = ("critical", "high", "medium", "low", "info")
CONFIDENCES = ("confirmed", "likely", "suspected")
FINDING_CATEGORIES = (
    "vulnerable_dependency",
    "exposed_credential",
    "injection",
    "deserialization",
    "xss",
    "access_control",
    "subprocess",
    "configuration",
    "missing_tests",
    "other",
)


class Repository(IdMixin, TimestampsMixin, Base):
    """A GitHub repository connected to an organization through the App."""

    __tablename__ = "repositories"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    installation_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("github_installations.id", ondelete="SET NULL")
    )
    github_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    full_name: Mapped[str] = mapped_column(Text, nullable=False)
    private: Mapped[bool] = mapped_column(Boolean, nullable=False)
    default_branch: Mapped[str] = mapped_column(Text, nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        enum("connection_status", *CONNECTION_STATUSES), nullable=False
    )
    status_message: Mapped[str | None] = mapped_column(Text)
    # [{ name, share }], share between 0 and 1.
    languages: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, default=list)
    last_analyzed_commit: Mapped[str | None] = mapped_column(Text)
    last_analyzed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    pushed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        UniqueConstraint("organization_id", "github_id"),
        Index("ix_repositories_organization_id_status", "organization_id", "status"),
    )


class RepositoryAnalysis(IdMixin, Base):
    """What was learned about a repository at one commit."""

    __tablename__ = "repository_analyses"

    repository_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False
    )
    commit: Mapped[str] = mapped_column(Text, nullable=False)
    analyzed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    # frameworks, entryPoints, modules, dependencies, testCommands,
    # buildCommands, documentation, concerns: the contract's analysis shape.
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)

    __table_args__ = (UniqueConstraint("repository_id", "commit"),)


class SecurityFinding(IdMixin, Base):
    __tablename__ = "security_findings"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    repository_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False
    )
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("runs.id", ondelete="SET NULL")
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(
        enum("finding_severity", *SEVERITIES), nullable=False
    )
    confidence: Mapped[str] = mapped_column(
        enum("finding_confidence", *CONFIDENCES), nullable=False
    )
    category: Mapped[str] = mapped_column(
        enum("finding_category", *FINDING_CATEGORIES), nullable=False
    )
    path: Mapped[str] = mapped_column(Text, nullable=False)
    line: Mapped[int | None] = mapped_column(Integer)
    evidence: Mapped[str] = mapped_column(Text, nullable=False, default="")
    remediation: Mapped[str] = mapped_column(Text, nullable=False, default="")
    advisory_url: Mapped[str | None] = mapped_column(Text)
    tool: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        enum("finding_status", "open", "fixed", "dismissed"),
        nullable=False,
        default="open",
    )
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    fixed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("ix_security_findings_repository_id_status", "repository_id", "status"),
    )
