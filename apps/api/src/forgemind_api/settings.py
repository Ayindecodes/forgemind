"""Everything the service reads from its environment, validated at startup.

A wrong or missing value fails the process before it serves a request, with a
message that names the variable, instead of failing at first use.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)

Environment = Literal["development", "test", "staging", "production"]
LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR"]

ENV_PREFIX = "FORGEMIND_"


class Settings(BaseModel):
    """The service configuration. Every field maps to FORGEMIND_<FIELD>."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    environment: Environment = "development"
    log_level: LogLevel = "INFO"
    port: int = Field(default=4200, ge=1, le=65535)
    web_origin: str = "http://localhost:3200"
    version: str = "0.1.0"
    commit: str = "unknown"
    otel_endpoint: str | None = None
    # postgresql+psycopg://user:password@host:port/database; required outside
    # development, where the service can start without a database.
    database_url: str | None = None
    # Where browsers reach this service; sign-in redirects point back here.
    api_origin: str = "http://localhost:4200"
    # "simulated" serves GitHub look-alike pages for development and tests;
    # "github" talks to GitHub and needs the App's OAuth client.
    github_provider: Literal["simulated", "github"] = "simulated"
    github_client_id: str | None = None
    github_client_secret: str | None = None
    # The GitHub App itself: its slug for the install page, its id and private
    # key for App tokens, and the secret GitHub signs webhooks with.
    github_app_slug: str = "forgemind"
    github_app_id: str | None = None
    github_app_private_key: str | None = None
    github_webhook_secret: str | None = None
    session_days: int = Field(default=7, ge=1, le=90)

    @field_validator("web_origin", "otel_endpoint", "api_origin")
    @classmethod
    def _http_origin(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not value.startswith(("http://", "https://")) or value.endswith("/"):
            raise ValueError("must be an http(s) origin without a trailing slash")
        return value

    @field_validator("database_url")
    @classmethod
    def _postgres_url(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith("postgresql+psycopg://"):
            raise ValueError("must start with postgresql+psycopg://")
        return value

    @model_validator(mode="after")
    def _database_outside_development(self) -> Settings:
        if self.environment != "development" and self.database_url is None:
            raise ValueError(
                f"{ENV_PREFIX}DATABASE_URL is required in {self.environment}"
            )
        return self

    @model_validator(mode="after")
    def _github_credentials(self) -> Settings:
        if self.environment == "production" and self.github_provider != "github":
            raise ValueError("production must use the github provider")
        if self.github_provider == "github":
            missing = [
                name
                for name, value in (
                    ("GITHUB_CLIENT_ID", self.github_client_id),
                    ("GITHUB_CLIENT_SECRET", self.github_client_secret),
                    ("GITHUB_APP_ID", self.github_app_id),
                    ("GITHUB_APP_PRIVATE_KEY", self.github_app_private_key),
                    ("GITHUB_WEBHOOK_SECRET", self.github_webhook_secret),
                )
                if not value
            ]
            if missing:
                raise ValueError(
                    "the github provider needs "
                    + ", ".join(f"{ENV_PREFIX}{name}" for name in missing)
                )
        return self


class SettingsError(RuntimeError):
    """Raised when the environment does not describe a usable configuration."""


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    """Read the settings from `env`, or from the process environment.

    Only variables with the FORGEMIND_ prefix count. Raises SettingsError
    naming every bad variable.
    """
    source = os.environ if env is None else env
    values = {
        key[len(ENV_PREFIX) :].lower(): value
        for key, value in source.items()
        if key.startswith(ENV_PREFIX)
    }
    try:
        return Settings.model_validate(values)
    except ValidationError as error:
        problems = ", ".join(
            f"{ENV_PREFIX}{'.'.join(str(part) for part in issue['loc']).upper()}: "
            f"{issue['msg']}"
            for issue in error.errors()
        )
        raise SettingsError(f"invalid configuration: {problems}") from error
