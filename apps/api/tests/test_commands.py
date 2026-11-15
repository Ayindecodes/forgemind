"""What `python -m forgemind_api <command>` asks of its environment."""

from typing import Any

import pytest
import uvicorn

from forgemind_api.__main__ import main
from forgemind_api.settings import SettingsError


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
