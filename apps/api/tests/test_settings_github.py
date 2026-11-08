import pytest

from forgemind_api.settings import SettingsError, load_settings

DB = {"FORGEMIND_DATABASE_URL": "postgresql+psycopg://a:b@db/c"}


def test_production_must_talk_to_github_itself() -> None:
    with pytest.raises(SettingsError, match="production must use the github provider"):
        load_settings({**DB, "FORGEMIND_ENVIRONMENT": "production"})


def test_the_github_provider_needs_its_client() -> None:
    with pytest.raises(SettingsError, match="GITHUB_CLIENT_ID"):
        load_settings({"FORGEMIND_GITHUB_PROVIDER": "github"})
    with pytest.raises(SettingsError, match="GITHUB_APP_ID"):
        load_settings(
            {
                "FORGEMIND_GITHUB_PROVIDER": "github",
                "FORGEMIND_GITHUB_CLIENT_ID": "id",
                "FORGEMIND_GITHUB_CLIENT_SECRET": "secret",
            }
        )
    settings = load_settings(
        {
            "FORGEMIND_GITHUB_PROVIDER": "github",
            "FORGEMIND_GITHUB_CLIENT_ID": "id",
            "FORGEMIND_GITHUB_CLIENT_SECRET": "secret",
            "FORGEMIND_GITHUB_APP_ID": "1",
            "FORGEMIND_GITHUB_APP_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----",
            "FORGEMIND_GITHUB_WEBHOOK_SECRET": "hook",
        }
    )
    assert settings.github_provider == "github"
    assert settings.github_app_slug == "forgemind"


def test_development_simulates_github_by_default() -> None:
    assert load_settings({}).github_provider == "simulated"
    assert load_settings({}).session_days == 7
