"""Request and response bodies in the contract's shape: camelCase on the wire."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from pydantic.alias_generators import to_camel


class Wire(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, serialize_by_alias=True
    )


class UserOut(Wire):
    id: str
    email: str
    name: str
    avatar_url: str | None
    github_login: str | None
    created_at: datetime


Role = Literal["owner", "admin", "developer", "reviewer", "viewer"]


class SessionOut(Wire):
    user: UserOut
    organization_id: str | None
    role: Role | None
    expires_at: datetime


class GitHubStartIn(Wire):
    next: str | None = None

    @field_validator("next")
    @classmethod
    def _path_on_this_app(cls, value: str | None) -> str | None:
        """A path on this app, never a full URL or a protocol-relative one."""
        if value is not None and (not value.startswith("/") or value.startswith("//")):
            raise ValueError("must be a path on this app")
        return value


class GitHubRedirectOut(Wire):
    url: str
    state: str


class GitHubCallbackIn(Wire):
    code: str = Field(min_length=1)
    state: str = Field(min_length=1)


class OkOut(Wire):
    ok: Literal[True] = True


class OrganizationOut(Wire):
    id: str
    name: str
    slug: str
    plan: Literal["free", "team", "enterprise"]
    created_at: datetime


class CreateOrganizationIn(Wire):
    name: str = Field(min_length=2, max_length=80)

    @field_validator("name")
    @classmethod
    def _trimmed(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("must be at least 2 characters")
        return value


class MemberOut(Wire):
    user: UserOut
    role: Role
    joined_at: datetime


class InviteMemberIn(Wire):
    email: EmailStr
    name: str = Field(min_length=1, max_length=80)
    role: Role


class UpdateMemberRoleIn(Wire):
    role: Role


class AuditTargetOut(Wire):
    type: str
    id: str
    label: str


class AuditEventOut(Wire):
    id: str
    actor_id: str
    actor_name: str
    action: str
    target: AuditTargetOut
    at: datetime


class AuditPageOut(Wire):
    items: list[AuditEventOut]
    next_cursor: str | None


class PermissionOut(Wire):
    name: str
    access: Literal["read", "write"]
    reason: str


class InstallationOut(Wire):
    id: str
    account_login: str
    account_type: Literal["user", "organization"]
    repository_selection: Literal["all", "selected"]
    permissions: list[PermissionOut]
    installed_at: datetime


class InstallationStateOut(Wire):
    installation: InstallationOut | None


class InstallCallbackIn(Wire):
    installation_id: str = Field(min_length=1)
    state: str = Field(min_length=1)


class GitHubRepositoryOut(Wire):
    github_id: int
    full_name: str
    private: bool
    default_branch: str
    description: str | None
    pushed_at: datetime
    connected_repository_id: str | None


class LanguageOut(Wire):
    name: str
    share: float


ConnectionStatus = Literal["connected", "analyzing", "error", "revoked"]


class RepositoryOut(Wire):
    id: str
    organization_id: str
    github_id: int
    full_name: str
    default_branch: str
    private: bool
    url: str
    status: ConnectionStatus
    status_message: str | None
    languages: list[LanguageOut]
    last_analyzed_commit: str | None
    last_analyzed_at: datetime | None
    open_findings: int
    latest_task_id: str | None
    pushed_at: datetime
    connected_at: datetime


class RepositoryPageOut(Wire):
    items: list[RepositoryOut]
    next_cursor: str | None


class ConnectRepositoryIn(Wire):
    github_id: int
    full_name: str = Field(pattern=r"^[^/\s]+/[^/\s]+$")
