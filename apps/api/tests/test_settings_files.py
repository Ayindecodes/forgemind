"""Settings given as files, which is how a deployment hands over a secret
without putting it in the environment."""

import traceback
from pathlib import Path

import pytest

from forgemind_api.settings import SettingsError, load_settings


def test_a_value_is_read_from_the_file_its_variable_names(tmp_path: Path) -> None:
    secret = tmp_path / "webhook_secret"
    secret.write_text("s3cret\n")
    key = tmp_path / "private_key"
    key.write_text("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\r\n")

    settings = load_settings(
        {
            "FORGEMIND_GITHUB_WEBHOOK_SECRET_FILE": str(secret),
            "FORGEMIND_GITHUB_APP_PRIVATE_KEY_FILE": str(key),
        }
    )

    # The line ending a file ends with is not part of the value; the lines
    # inside a key are.
    assert settings.github_webhook_secret == "s3cret"
    assert settings.github_app_private_key == (
        "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"
    )


def test_a_value_given_both_ways_is_refused(tmp_path: Path) -> None:
    secret = tmp_path / "webhook_secret"
    secret.write_text("from-the-file")
    with pytest.raises(
        SettingsError,
        match="FORGEMIND_GITHUB_WEBHOOK_SECRET and "
        "FORGEMIND_GITHUB_WEBHOOK_SECRET_FILE are both set",
    ):
        load_settings(
            {
                "FORGEMIND_GITHUB_WEBHOOK_SECRET": "from-the-environment",
                "FORGEMIND_GITHUB_WEBHOOK_SECRET_FILE": str(secret),
            }
        )


def test_a_file_that_cannot_be_read_or_holds_nothing_is_named(tmp_path: Path) -> None:
    missing = tmp_path / "nowhere"
    with pytest.raises(SettingsError) as failure:
        load_settings({"FORGEMIND_GITHUB_CLIENT_SECRET_FILE": str(missing)})
    assert str(failure.value) == (
        "invalid configuration: FORGEMIND_GITHUB_CLIENT_SECRET_FILE: "
        f"cannot read {missing} (No such file or directory)"
    )

    empty = tmp_path / "empty"
    empty.write_text("\n")
    binary = tmp_path / "binary"
    binary.write_bytes(b"\xff\xfe\x00")
    with pytest.raises(SettingsError) as failure:
        load_settings(
            {
                "FORGEMIND_GITHUB_CLIENT_SECRET_FILE": str(empty),
                "FORGEMIND_GITHUB_WEBHOOK_SECRET_FILE": str(binary),
            }
        )
    assert f"FORGEMIND_GITHUB_CLIENT_SECRET_FILE: {empty} is empty" in str(
        failure.value
    )
    assert (
        f"FORGEMIND_GITHUB_WEBHOOK_SECRET_FILE: cannot read {binary} (not text)"
        in str(failure.value)
    )


def test_what_a_file_holds_is_never_repeated_in_a_complaint(tmp_path: Path) -> None:
    url = tmp_path / "database_url"
    url.write_text("postgres://fm:hunter2@db/fm\n")
    with pytest.raises(SettingsError) as failure:
        load_settings({"FORGEMIND_DATABASE_URL_FILE": str(url)})
    assert "FORGEMIND_DATABASE_URL: " in str(failure.value)
    assert "postgresql+psycopg" in str(failure.value)
    assert "hunter2" not in str(failure.value)
    # Nor in the traceback of it, which is what a process that was not
    # expecting the complaint would print.
    assert "hunter2" not in "".join(traceback.format_exception(failure.value))


def test_what_was_given_beside_a_refused_setting_is_not_repeated_either(
    tmp_path: Path,
) -> None:
    secret = tmp_path / "webhook_secret"
    secret.write_text("swordfish\n")
    with pytest.raises(SettingsError) as failure:
        load_settings(
            {
                "FORGEMIND_ENVIRONMENT": "test",
                "FORGEMIND_DATABASE_URL": "postgresql+psycopg://fm:hunter2@db/fm",
                "FORGEMIND_GITHUB_PROVIDER": "github",
                "FORGEMIND_GITHUB_WEBHOOK_SECRET_FILE": str(secret),
            }
        )
    printed = "".join(traceback.format_exception(failure.value))
    assert "the github provider needs FORGEMIND_GITHUB_CLIENT_ID" in printed
    assert "hunter2" not in printed
    assert "swordfish" not in printed
