import pytest

from forgemind_api.settings import SettingsError, load_settings


def test_defaults_describe_local_development() -> None:
    settings = load_settings({})
    assert settings.environment == "development"
    assert settings.port == 4200
    assert settings.web_origin == "http://localhost:3200"
    assert settings.otel_endpoint is None


def test_reads_prefixed_variables_only() -> None:
    settings = load_settings(
        {
            "FORGEMIND_ENVIRONMENT": "staging",
            "FORGEMIND_PORT": "8080",
            "FORGEMIND_COMMIT": "abc1234",
            "PORT": "1",
        }
    )
    assert settings.environment == "staging"
    assert settings.port == 8080
    assert settings.commit == "abc1234"


def test_names_every_bad_variable() -> None:
    with pytest.raises(SettingsError) as raised:
        load_settings(
            {
                "FORGEMIND_ENVIRONMENT": "prod",
                "FORGEMIND_PORT": "70000",
                "FORGEMIND_WEB_ORIGIN": "localhost:3200",
            }
        )
    message = str(raised.value)
    assert "FORGEMIND_ENVIRONMENT" in message
    assert "FORGEMIND_PORT" in message
    assert "FORGEMIND_WEB_ORIGIN" in message


def test_origins_have_no_trailing_slash() -> None:
    with pytest.raises(SettingsError):
        load_settings({"FORGEMIND_OTEL_ENDPOINT": "http://otel:4318/"})
    assert (
        load_settings({"FORGEMIND_OTEL_ENDPOINT": "http://otel:4318"}).otel_endpoint
        == "http://otel:4318"
    )


def test_a_mapping_ignores_the_process_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FORGEMIND_PORT", "9999")
    assert load_settings({}).port == 4200
    assert load_settings().port == 9999
