"""Where repositories are checked out, how long and how large a checkout may
be, and where this machine's own repositories are offered from."""

import pytest

from forgemind_api.settings import SettingsError, load_settings

GITHUB = {
    "FORGEMIND_GITHUB_PROVIDER": "github",
    "FORGEMIND_GITHUB_CLIENT_ID": "id",
    "FORGEMIND_GITHUB_CLIENT_SECRET": "secret",
    "FORGEMIND_GITHUB_APP_ID": "1",
    "FORGEMIND_GITHUB_APP_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----",
    "FORGEMIND_GITHUB_WEBHOOK_SECRET": "hook",
}


def test_a_checkout_is_bounded_in_time_and_size_by_default() -> None:
    settings = load_settings({})
    assert settings.workspace_root is None
    assert settings.indexing_seconds == 300
    assert settings.workspace_megabytes == 512
    assert settings.local_repositories is None


def test_the_bounds_and_the_directories_are_read() -> None:
    settings = load_settings(
        {
            "FORGEMIND_WORKSPACE_ROOT": "/var/lib/forgemind/workspaces",
            "FORGEMIND_INDEXING_SECONDS": "90",
            "FORGEMIND_WORKSPACE_MEGABYTES": "64",
            "FORGEMIND_LOCAL_REPOSITORIES": "/srv/repositories",
        }
    )
    assert settings.workspace_root == "/var/lib/forgemind/workspaces"
    assert settings.indexing_seconds == 90
    assert settings.workspace_megabytes == 64
    assert settings.local_repositories == "/srv/repositories"


@pytest.mark.parametrize(
    ("variable", "value"),
    [
        ("FORGEMIND_INDEXING_SECONDS", "4"),
        ("FORGEMIND_INDEXING_SECONDS", "3601"),
        ("FORGEMIND_WORKSPACE_MEGABYTES", "0"),
        ("FORGEMIND_WORKSPACE_MEGABYTES", "20001"),
        ("FORGEMIND_WORKSPACE_MEGABYTES", "1.5"),
    ],
)
def test_no_checkout_is_unbounded(variable: str, value: str) -> None:
    with pytest.raises(SettingsError, match=variable):
        load_settings({variable: value})


@pytest.mark.parametrize(
    "variable", ["FORGEMIND_WORKSPACE_ROOT", "FORGEMIND_LOCAL_REPOSITORIES"]
)
def test_a_directory_is_named_from_the_root(variable: str) -> None:
    """Wherever the process was started from, it is the same directory."""
    for relative in ("workspaces", "./workspaces", "../workspaces", ""):
        with pytest.raises(SettingsError, match=f"{variable}: .*absolute path"):
            load_settings({variable: relative})


def test_this_machines_repositories_are_offered_by_the_simulated_github_alone() -> None:
    with pytest.raises(SettingsError) as refused:
        load_settings({**GITHUB, "FORGEMIND_LOCAL_REPOSITORIES": "/srv/repositories"})
    assert "FORGEMIND_LOCAL_REPOSITORIES is read by the simulated provider only" in str(
        refused.value
    )
    assert "the github provider clones from GitHub" in str(refused.value)
    # Where to check out is for either.
    settings = load_settings({**GITHUB, "FORGEMIND_WORKSPACE_ROOT": "/var/workspaces"})
    assert settings.workspace_root == "/var/workspaces"
