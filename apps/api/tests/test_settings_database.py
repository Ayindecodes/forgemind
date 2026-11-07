import pytest

from forgemind_api.settings import SettingsError, load_settings


def test_a_database_is_required_outside_development() -> None:
    with pytest.raises(SettingsError, match="FORGEMIND_DATABASE_URL is required"):
        load_settings({"FORGEMIND_ENVIRONMENT": "staging"})
    assert (
        load_settings(
            {
                "FORGEMIND_ENVIRONMENT": "staging",
                "FORGEMIND_DATABASE_URL": "postgresql+psycopg://a:b@db/c",
            }
        ).environment
        == "staging"
    )


def test_only_the_psycopg_driver_is_accepted() -> None:
    with pytest.raises(SettingsError, match="postgresql\\+psycopg"):
        load_settings({"FORGEMIND_DATABASE_URL": "postgres://a:b@db/c"})
