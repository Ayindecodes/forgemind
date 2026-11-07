"""Request and response bodies in the contract's shape: camelCase on the wire."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
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
