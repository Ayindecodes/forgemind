"""Where repositories are checked out, how long and how large a checkout may
be, and where this machine's own repositories are offered from."""

import math

import pytest

from forgemind_api.github import RealGitHub, SimulatedGitHub, make_provider
from forgemind_api.queue import EXECUTE_RUN, INDEX_REPOSITORY
from forgemind_api.settings import Settings, SettingsError, load_settings
from forgemind_api.worker import build_worker

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
    assert isinstance(make_provider(settings), RealGitHub)


def test_the_simulated_github_is_given_both_directories() -> None:
    github = make_provider(
        Settings(workspace_root="/var/workspaces", local_repositories="/srv/repos")
    )
    assert isinstance(github, SimulatedGitHub)
    assert github.workspace_root == "/var/workspaces"
    assert github.local_repositories == "/srv/repos"


def test_a_worker_runs_and_indexes_and_ends_an_indexing_that_outlasts_its_limit() -> (
    None
):
    settings = Settings(
        environment="test",
        database_url="postgresql+psycopg://a:b@db/c",
        redis_url="redis://queue:6379/0",
        indexing_seconds=42.5,
    )
    celery = build_worker(settings)
    try:
        ours = {name for name in celery.tasks if name.startswith("forgemind.")}
        assert ours == {EXECUTE_RUN, INDEX_REPOSITORY}
        # A minute past the checkout's own limit, the process is ended.
        assert celery.tasks[INDEX_REPOSITORY].time_limit == math.ceil(42.5) + 60 == 103
    finally:
        celery.close()
