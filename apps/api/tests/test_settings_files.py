"""Settings given as files, which is how a deployment hands over a secret
without putting it in the environment."""

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
