"""Everything the service reads from its environment, validated at startup.

A wrong or missing value fails the process before it serves a request, with a
message that names the variable, instead of failing at first use.
"""

from __future__ import annotations

import json
import os
from collections.abc import Mapping
from decimal import Decimal
from pathlib import Path
from typing import Any, Literal, cast

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    ValidationInfo,
    field_validator,
    model_validator,
)
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

Environment = Literal["development", "test", "staging", "production"]
LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR"]

ENV_PREFIX = "FORGEMIND_"
# FORGEMIND_<NAME>_FILE names a file that holds the value of FORGEMIND_<NAME>.
FILE_SUFFIX = "_FILE"

# What a process is, for what it has to be given. The API signs people in,
# reads what an installation grants and checks webhooks; a worker only asks
# GitHub for the token it clones with; nothing else speaks to GitHub.
Process = Literal["api", "worker", "other"]

# The GitHub credentials each kind of process needs with the github provider.
# A process asks for these and no others, so a deployment can keep each
# secret to the processes that use it.
GITHUB_NEEDS: dict[Process, tuple[str, ...]] = {
    "api": (
        "GITHUB_CLIENT_ID",
        "GITHUB_CLIENT_SECRET",
        "GITHUB_APP_ID",
        "GITHUB_APP_PRIVATE_KEY",
        "GITHUB_WEBHOOK_SECRET",
    ),
    "worker": ("GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY"),
    "other": (),
}


class TokenPrice(BaseModel):
    """US dollars for a million tokens read by a model, and for a million
    written by it."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    input: Decimal = Field(ge=0)
    output: Decimal = Field(ge=0)


class Prices(BaseModel):
    """What usage is taken to cost when a cost is estimated. Nothing has a
    price unless one is set here: no rate is built in, since nobody's rates
    are this service's to assume."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    # By "provider/model", as model calls name them.
    tokens: dict[str, TokenPrice] = Field(default_factory=dict[str, TokenPrice])
    # US dollars for an hour of sandbox time.
    sandbox_hour: Decimal | None = Field(default=None, ge=0)

    @field_validator("tokens")
    @classmethod
    def _named_by_provider_and_model(
        cls, value: dict[str, TokenPrice]
    ) -> dict[str, TokenPrice]:
        for name in value:
            provider, _, model = name.partition("/")
            if not provider or not model:
                raise ValueError(f"{name!r} must be written provider/model")
        return value


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
    # The password of the URL's user, for a URL written without one, so that
    # the password can be kept in a file of its own. It is put into
    # `database_url`, which is what everything else reads.
    database_password: str | None = None
    # Where browsers reach this service; sign-in redirects point back here.
    # With a path when a proxy serves it under one and takes the path off,
    # as in https://staging.example.com/api.
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
    # redis://host:port/db; the queue the workers take runs from. Required in
    # staging and production. Without it tasks are recorded and wait.
    redis_url: str | None = None
    # How many runs one worker executes at a time.
    worker_concurrency: int = Field(default=2, ge=1, le=16)
    # A worker proves it still holds a run this often, and a run whose proof
    # is older than the stale limit is taken to have lost its worker.
    worker_heartbeat_seconds: float = Field(default=5, gt=0, le=60)
    worker_stale_seconds: float = Field(default=30, gt=0, le=600)
    # How many times a run may be picked up before it is failed instead.
    worker_max_attempts: int = Field(default=3, ge=1, le=10)
    # How often abandoned and undelivered runs are looked for, and how long a
    # run may wait on the queue before it is put there again.
    worker_sweep_seconds: float = Field(default=10, gt=0, le=300)
    worker_redispatch_seconds: float = Field(default=120, gt=0, le=3600)
    # Where repositories are checked out to be read: a directory of this
    # service's own. Unset, the machine's temporary directory. A checkout is
    # removed as soon as it has been read.
    workspace_root: str | None = None
    # The longest one checkout may take, and the most it may download or
    # write, before the repository is refused.
    indexing_seconds: float = Field(default=300, ge=5, le=3600)
    workspace_megabytes: int = Field(default=512, ge=1, le=20_000)
    # A directory of git repositories on this machine, laid out owner/name,
    # which the simulated GitHub offers beside its own made-up ones. It is
    # how a real repository is inspected where no GitHub App is registered.
    local_repositories: str | None = None
    # JSON: {"tokens": {"provider/model": {"input": 0, "output": 0}},
    # "sandbox_hour": 0}, in US dollars per million tokens and per hour. The
    # cost of usage is estimated from these, and reported as unavailable for
    # anything used that has no price here.
    prices: Prices = Prices()

    @model_validator(mode="before")
    @classmethod
    def _password_into_the_url(cls, data: Any) -> Any:
        if not isinstance(data, Mapping):
            return data
        values = dict(cast("Mapping[str, Any]", data))
        password = values.get("database_password")
        url = values.get("database_url")
        if password is None:
            return values
        if not isinstance(url, str) or not isinstance(password, str):
            raise ValueError(
                f"{ENV_PREFIX}DATABASE_PASSWORD needs {ENV_PREFIX}DATABASE_URL"
            )
        try:
            parsed = make_url(url)
        except ArgumentError:
            # Said by the URL's own check, in its own words.
            return values
        if parsed.password is not None:
            raise ValueError(
                f"{ENV_PREFIX}DATABASE_URL already carries a password; "
                f"leave it out there or do not set {ENV_PREFIX}DATABASE_PASSWORD"
            )
        values["database_url"] = parsed.set(password=password).render_as_string(
            hide_password=False
        )
        return values

    @field_validator("prices", mode="before")
    @classmethod
    def _prices_from_json(cls, value: Any) -> Any:
        if not isinstance(value, str):
            return value
        try:
            # Decimals from the digits as written, not by way of a float.
            return json.loads(value, parse_float=Decimal)
        except json.JSONDecodeError as error:
            raise ValueError(f"must be JSON ({error.msg})") from None

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

    @field_validator("redis_url")
    @classmethod
    def _redis_url(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith(("redis://", "rediss://")):
            raise ValueError("must start with redis:// or rediss://")
        return value

    @field_validator("workspace_root", "local_repositories")
    @classmethod
    def _absolute_directory(cls, value: str | None) -> str | None:
        if value is not None and not os.path.isabs(value):
            raise ValueError("must be an absolute path")
        return value

    @model_validator(mode="after")
    def _database_outside_development(self) -> Settings:
        if self.environment != "development" and self.database_url is None:
            raise ValueError(
                f"{ENV_PREFIX}DATABASE_URL is required in {self.environment}"
            )
        return self

    @model_validator(mode="after")
    def _queue_where_work_must_run(self) -> Settings:
        if self.environment in ("staging", "production") and self.redis_url is None:
            raise ValueError(f"{ENV_PREFIX}REDIS_URL is required in {self.environment}")
        if self.worker_stale_seconds < 2 * self.worker_heartbeat_seconds:
            raise ValueError(
                f"{ENV_PREFIX}WORKER_STALE_SECONDS must be at least twice "
                f"{ENV_PREFIX}WORKER_HEARTBEAT_SECONDS, or live runs look abandoned"
            )
        return self

    @model_validator(mode="after")
    def _github_credentials(self, info: ValidationInfo) -> Settings:
        if self.environment == "production" and self.github_provider != "github":
            raise ValueError("production must use the github provider")
        if self.github_provider == "github":
            # Built directly, the settings are the API's: it needs them all.
            context: dict[str, Any] = info.context or {}
            process: Process = context.get("process", "api")
            missing = [
                name
                for name in GITHUB_NEEDS[process]
                if not getattr(self, name.lower())
            ]
            if missing:
                raise ValueError(
                    "the github provider needs "
                    + ", ".join(f"{ENV_PREFIX}{name}" for name in missing)
                )
            if self.local_repositories is not None:
                raise ValueError(
                    f"{ENV_PREFIX}LOCAL_REPOSITORIES is read by the simulated "
                    "provider only; the github provider clones from GitHub"
                )
        return self


class SettingsError(RuntimeError):
    """Raised when the environment does not describe a usable configuration."""


def read_values(source: Mapping[str, str]) -> dict[str, str]:
    """The settings `source` gives, by field name.

    Only variables with the FORGEMIND_ prefix count. FORGEMIND_<NAME>_FILE
    gives the value of FORGEMIND_<NAME> as the contents of a file, less the
    line ending: that is how a secret is given without putting it in the
    environment.
    """
    values: dict[str, str] = {}
    from_files: dict[str, str] = {}
    for key, value in source.items():
        if not key.startswith(ENV_PREFIX):
            continue
        if key.endswith(FILE_SUFFIX):
            from_files[key.removesuffix(FILE_SUFFIX)] = value
        else:
            values[key[len(ENV_PREFIX) :].lower()] = value
    problems: list[str] = []
    for variable, path in from_files.items():
        name = variable[len(ENV_PREFIX) :].lower()
        if name in values:
            problems.append(f"{variable} and {variable}{FILE_SUFFIX} are both set")
            continue
        try:
            content = Path(path).read_text().rstrip("\r\n")
        except (OSError, UnicodeDecodeError) as error:
            reason = error.strerror if isinstance(error, OSError) else "not text"
            problems.append(f"{variable}{FILE_SUFFIX}: cannot read {path} ({reason})")
            continue
        if not content:
            problems.append(f"{variable}{FILE_SUFFIX}: {path} is empty")
            continue
        values[name] = content
    if problems:
        raise SettingsError(f"invalid configuration: {', '.join(problems)}")
    return values


def load_settings(
    env: Mapping[str, str] | None = None, process: Process = "api"
) -> Settings:
    """Read the settings from `env`, or from the process environment, for the
    kind of process that is starting. Raises SettingsError naming every bad
    variable.
    """
    values = read_values(os.environ if env is None else env)
    try:
        return Settings.model_validate(values, context={"process": process})
    except ValidationError as error:
        problems = ", ".join(
            f"{ENV_PREFIX}{'.'.join(str(part) for part in issue['loc']).upper()}: "
            f"{issue['msg']}"
            for issue in error.errors()
        )
        # Not `from error`: under it a traceback would print what the library
        # was given, and a refused value may be a secret or hold one.
        raise SettingsError(f"invalid configuration: {problems}") from None
