import pytest

from forgemind_api.settings import SettingsError, load_settings

DB = {"FORGEMIND_DATABASE_URL": "postgresql+psycopg://a:b@db/c"}


def test_production_must_talk_to_github_itself() -> None:
    with pytest.raises(SettingsError, match="production must use the github provider"):
        load_settings({**DB, "FORGEMIND_ENVIRONMENT": "production"})


def test_the_github_provider_needs_its_client() -> None:
    with pytest.raises(SettingsError, match="GITHUB_CLIENT_ID"):
        load_settings({"FORGEMIND_GITHUB_PROVIDER": "github"})
    settings = load_settings(
        {
            "FORGEMIND_GITHUB_PROVIDER": "github",
            "FORGEMIND_GITHUB_CLIENT_ID": "id",
            "FORGEMIND_GITHUB_CLIENT_SECRET": "secret",
        }
    )
    assert settings.github_provider == "github"


def test_development_simulates_github_by_default() -> None:
    assert load_settings({}).github_provider == "simulated"
    assert load_settings({}).session_days == 7
