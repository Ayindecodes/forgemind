"""What `python -m forgemind_api <command>` asks of its environment, and the
revision `migrate` stops at."""

import subprocess
import sys
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
import uvicorn
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.pool import NullPool

from forgemind_api.__main__ import main
from forgemind_api.settings import SettingsError, load_settings

# Every character of it means something in a URL.
PASSWORD = "p@ss/w:rd#? %41"


def schema(url: str) -> tuple[str, set[str]]:
    """The revision the database at `url` is at, and what a usage record has."""
    engine = create_engine(url, poolclass=NullPool)
    try:
        with engine.connect() as connection:
            revision = connection.execute(
                text("select version_num from alembic_version")
            ).scalar_one()
        columns = inspect(engine).get_columns("usage_records")
        return revision, {column["name"] for column in columns}
    finally:
        engine.dispose()


@pytest.fixture
def guarded_database_url(database_url: str) -> Iterator[str]:
    """The URL, without the password, of an empty database whose owner has
    PASSWORD. Both are dropped afterwards."""
    name = f"forgemind_{uuid.uuid4().hex[:12]}"
    admin = create_engine(
        database_url, isolation_level="AUTOCOMMIT", poolclass=NullPool
    )
    with admin.connect() as connection:
        # The driver reads a percent sign as a parameter's place.
        password = PASSWORD.replace("%", "%%")
        connection.exec_driver_sql(f"CREATE ROLE {name} LOGIN PASSWORD '{password}'")
        connection.exec_driver_sql(f"CREATE DATABASE {name} OWNER {name}")
    server = make_url(database_url)
    yield URL.create(
        server.drivername, name, host=server.host, port=server.port, database=name
    ).render_as_string()
    with admin.connect() as connection:
        connection.exec_driver_sql(f"DROP DATABASE {name} WITH (FORCE)")
        connection.exec_driver_sql(f"DROP ROLE {name}")
    admin.dispose()


def test_migrate_stops_at_the_revision_it_is_given(
    empty_database_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FORGEMIND_ENVIRONMENT", "test")
    monkeypatch.setenv("FORGEMIND_DATABASE_URL", empty_database_url)

    assert main(["migrate", "0005"]) == 0
    revision, columns = schema(empty_database_url)
    assert revision == "0005"
    assert "quantity" in columns and "event_seq" not in columns

    # With none, it goes on to the newest, from wherever the database is.
    assert main(["migrate"]) == 0
    revision, columns = schema(empty_database_url)
    assert revision == "0006"
    assert "event_seq" in columns


def test_migrate_reaches_a_database_whose_password_a_url_must_escape(
    guarded_database_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FORGEMIND_ENVIRONMENT", "test")
    monkeypatch.setenv("FORGEMIND_DATABASE_URL", guarded_database_url)
    monkeypatch.setenv("FORGEMIND_DATABASE_PASSWORD", PASSWORD)

    assert main(["migrate"]) == 0

    url = load_settings().database_url
    assert url is not None and make_url(url).password == PASSWORD
    revision, _ = schema(url)
    assert revision == "0006"


def test_each_command_asks_for_the_github_credentials_it_uses(
    empty_database_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FORGEMIND_ENVIRONMENT", "staging")
    monkeypatch.setenv("FORGEMIND_DATABASE_URL", empty_database_url)
    monkeypatch.setenv("FORGEMIND_REDIS_URL", "redis://127.0.0.1:1/0")
    monkeypatch.setenv("FORGEMIND_GITHUB_PROVIDER", "github")

    # Nothing that only keeps the database is given a credential, or asks.
    assert main(["migrate"]) == 0
    assert main(["usage-check"]) == 0

    with pytest.raises(SettingsError) as failure:
        main(["worker"])
    assert str(failure.value).endswith(
        "the github provider needs FORGEMIND_GITHUB_APP_ID, "
        "FORGEMIND_GITHUB_APP_PRIVATE_KEY"
    )

    for command in (["serve"], []):
        with pytest.raises(SettingsError) as failure:
            main(command)
        assert str(failure.value).endswith(
            "the github provider needs FORGEMIND_GITHUB_CLIENT_ID, "
            "FORGEMIND_GITHUB_CLIENT_SECRET, FORGEMIND_GITHUB_APP_ID, "
            "FORGEMIND_GITHUB_APP_PRIVATE_KEY, FORGEMIND_GITHUB_WEBHOOK_SECRET"
        )


def test_check_reads_the_settings_a_command_would_and_does_nothing_more(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def never(*_: Any, **__: Any) -> int:
        raise AssertionError("check started what it was only asked about")

    monkeypatch.setattr(uvicorn, "run", never)
    monkeypatch.setattr("forgemind_api.__main__.run_worker", never)
    monkeypatch.setattr("forgemind_api.__main__.migrate", never)
    monkeypatch.setenv("FORGEMIND_ENVIRONMENT", "staging")
    monkeypatch.setenv("FORGEMIND_DATABASE_URL", "postgresql+psycopg://fm@db/fm")
    monkeypatch.setenv("FORGEMIND_REDIS_URL", "redis://127.0.0.1:1/0")
    monkeypatch.setenv("FORGEMIND_GITHUB_PROVIDER", "github")
    monkeypatch.setenv("FORGEMIND_GITHUB_APP_ID", "7")
    monkeypatch.setenv("FORGEMIND_GITHUB_APP_PRIVATE_KEY", "key")

    # These are a worker's settings and a migration's, and not the API's.
    assert main(["check", "worker"]) == 0
    assert main(["check", "migrate"]) == 0
    for command in (["check", "serve"], ["check"]):
        with pytest.raises(SettingsError) as failure:
            main(command)
        assert str(failure.value).endswith(
            "the github provider needs FORGEMIND_GITHUB_CLIENT_ID, "
            "FORGEMIND_GITHUB_CLIENT_SECRET, FORGEMIND_GITHUB_WEBHOOK_SECRET"
        )


def test_settings_it_cannot_use_end_a_command_in_a_line_without_their_values(
    tmp_path: Path,
) -> None:
    secret = tmp_path / "client_secret"
    secret.write_text("swordfish\n")
    ended = subprocess.run(
        [sys.executable, "-m", "forgemind_api", "serve"],
        env={
            "FORGEMIND_ENVIRONMENT": "staging",
            "FORGEMIND_DATABASE_URL": "postgres://fm:hunter2@db/fm",
            "FORGEMIND_GITHUB_PROVIDER": "github",
            "FORGEMIND_GITHUB_CLIENT_SECRET_FILE": str(secret),
        },
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )

    assert ended.returncode == 2
    assert ended.stdout == ""
    assert ended.stderr.startswith("invalid configuration: FORGEMIND_DATABASE_URL: ")
    assert ended.stderr.count("\n") == 1
    assert "hunter2" not in ended.stderr
    assert "swordfish" not in ended.stderr
