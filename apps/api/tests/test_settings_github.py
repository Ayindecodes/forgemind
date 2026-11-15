import pytest

from forgemind_api.settings import Settings, SettingsError, load_settings

DB = {
    "FORGEMIND_DATABASE_URL": "postgresql+psycopg://a:b@db/c",
    "FORGEMIND_REDIS_URL": "redis://queue:6379/0",
}


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


GITHUB = {**DB, "FORGEMIND_GITHUB_PROVIDER": "github"}
APP = {
    "FORGEMIND_GITHUB_APP_ID": "1",
    "FORGEMIND_GITHUB_APP_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----",
}


def test_a_worker_needs_only_what_it_clones_with() -> None:
    settings = load_settings({**GITHUB, **APP}, process="worker")
    assert settings.github_provider == "github"
    assert settings.github_client_secret is None
    assert settings.github_webhook_secret is None

    with pytest.raises(SettingsError) as failure:
        load_settings(GITHUB, process="worker")
    assert str(failure.value).endswith(
        "the github provider needs FORGEMIND_GITHUB_APP_ID, "
        "FORGEMIND_GITHUB_APP_PRIVATE_KEY"
    )


def test_the_api_needs_every_credential_however_it_is_built() -> None:
    with pytest.raises(SettingsError) as failure:
        load_settings({**GITHUB, **APP})
    assert str(failure.value).endswith(
        "the github provider needs FORGEMIND_GITHUB_CLIENT_ID, "
        "FORGEMIND_GITHUB_CLIENT_SECRET, FORGEMIND_GITHUB_WEBHOOK_SECRET"
    )
    with pytest.raises(ValueError, match="GITHUB_CLIENT_ID"):
        Settings(github_provider="github", github_app_id="1")


def test_a_process_that_never_speaks_to_github_needs_no_credential() -> None:
    settings = load_settings(GITHUB, process="other")
    assert settings.github_provider == "github"
    assert settings.github_app_private_key is None
