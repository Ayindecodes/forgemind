from pathlib import Path

import pytest
from sqlalchemy.engine import make_url

from forgemind_api.settings import SettingsError, load_settings


def test_a_database_is_required_outside_development() -> None:
    with pytest.raises(SettingsError, match="FORGEMIND_DATABASE_URL is required"):
        load_settings({"FORGEMIND_ENVIRONMENT": "staging"})
    assert (
        load_settings(
            {
                "FORGEMIND_ENVIRONMENT": "staging",
                "FORGEMIND_DATABASE_URL": "postgresql+psycopg://a:b@db/c",
                "FORGEMIND_REDIS_URL": "redis://queue:6379/0",
            }
        ).environment
        == "staging"
    )


def test_only_the_psycopg_driver_is_accepted() -> None:
    with pytest.raises(SettingsError, match="postgresql\\+psycopg"):
        load_settings({"FORGEMIND_DATABASE_URL": "postgres://a:b@db/c"})


def test_a_password_kept_apart_is_put_into_the_url(tmp_path: Path) -> None:
    awkward = "p@ss/w:rd#? %41"
    settings = load_settings(
        {
            "FORGEMIND_DATABASE_URL": "postgresql+psycopg://fm@db:5432/staging",
            "FORGEMIND_DATABASE_PASSWORD": awkward,
        }
    )
    assert settings.database_url is not None
    url = make_url(settings.database_url)
    assert (url.drivername, url.username, url.host, url.port, url.database) == (
        "postgresql+psycopg",
        "fm",
        "db",
        5432,
        "staging",
    )
    assert url.password == awkward

    secret = tmp_path / "postgres_password"
    secret.write_text("from-a-file\n")
    settings = load_settings(
        {
            "FORGEMIND_DATABASE_URL": "postgresql+psycopg://fm@db:5432/staging",
            "FORGEMIND_DATABASE_PASSWORD_FILE": str(secret),
        }
    )
    assert settings.database_url is not None
    assert make_url(settings.database_url).password == "from-a-file"


def test_a_password_kept_apart_needs_a_url_without_one() -> None:
    with pytest.raises(
        SettingsError, match="FORGEMIND_DATABASE_PASSWORD needs FORGEMIND_DATABASE_URL"
    ):
        load_settings({"FORGEMIND_DATABASE_PASSWORD": "secret"})
    with pytest.raises(SettingsError) as failure:
        load_settings(
            {
                "FORGEMIND_DATABASE_URL": "postgresql+psycopg://fm:hunter2@db/fm",
                "FORGEMIND_DATABASE_PASSWORD": "swordfish",
            }
        )
    assert "FORGEMIND_DATABASE_URL already carries a password" in str(failure.value)
    assert "hunter2" not in str(failure.value)
    assert "swordfish" not in str(failure.value)
