"""People, organizations, membership, sessions and the GitHub installation."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from forgemind_api.models.base import Base, IdMixin, TimestampsMixin, enum

ROLES = ("owner", "admin", "developer", "reviewer", "viewer")
PLANS = ("free", "team", "enterprise")


class User(IdMixin, TimestampsMixin, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(Text)
    github_login: Mapped[str | None] = mapped_column(Text)
    github_user_id: Mapped[int | None] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(
        enum("user_status", "active", "disabled"), nullable=False, default="active"
    )

    __table_args__ = (
        Index("ix_users_email_lower", func.lower(email), unique=True),
        UniqueConstraint("github_user_id"),
    )


class Organization(IdMixin, TimestampsMixin, Base):
    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    plan: Mapped[str] = mapped_column(
        enum("organization_plan", *PLANS), nullable=False, default="free"
    )
    # Usage configuration: null means unlimited.
    concurrent_runs_max: Mapped[int | None] = mapped_column(Integer)
    monthly_runs_max: Mapped[int | None] = mapped_column(Integer)
    monthly_tokens_max: Mapped[int | None] = mapped_column(BigInteger)


class OrganizationMember(Base):
    __tablename__ = "organization_members"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[str] = mapped_column(enum("member_role", *ROLES), nullable=False)
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (Index("ix_organization_members_user_id", "user_id"),)


class Session(IdMixin, Base):
    """A signed-in browser. The cookie carries a token; only its hash is stored."""

    __tablename__ = "sessions"

    token_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("ix_sessions_user_id", "user_id"),)


class GitHubInstallation(IdMixin, TimestampsMixin, Base):
    __tablename__ = "github_installations"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    installation_id: Mapped[int] = mapped_column(
        BigInteger, nullable=False, unique=True
    )
    account_login: Mapped[str] = mapped_column(Text, nullable=False)
    account_type: Mapped[str] = mapped_column(
        enum("installation_account_type", "user", "organization"), nullable=False
    )
    repository_selection: Mapped[str] = mapped_column(
        enum("installation_selection", "all", "selected"), nullable=False
    )
    # [{ name, access, reason }], the permission table shown at install time.
    permissions: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, default=list)
    suspended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("ix_github_installations_organization_id", "organization_id"),
    )


class IntegrationCredential(IdMixin, TimestampsMixin, Base):
    """Where a secret lives, never the secret itself."""

    __tablename__ = "integration_credentials"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    kind: Mapped[str] = mapped_column(
        enum(
            "credential_kind",
            "installation_token",
            "oauth_token",
            "api_key",
            "webhook_secret",
        ),
        nullable=False,
    )
    secret_ref: Mapped[str] = mapped_column(Text, nullable=False)
    rotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (UniqueConstraint("organization_id", "provider", "kind"),)
