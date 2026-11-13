import os
import shutil
from pathlib import Path

import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session as DbSession

from forgemind_api import simulated_repositories
from forgemind_api.inspection import inspect_tree
from forgemind_api.models import (
    GitHubInstallation,
    Organization,
    OrganizationMember,
    Repository,
    RepositoryAnalysis,
    Session,
    User,
)
from forgemind_api.repositories import SUSPENDED
from forgemind_api.seed import REPOSITORIES, seed
from forgemind_api.settings import Settings, SettingsError
from forgemind_api.simulated_repositories import materialise
from forgemind_api.workspace import NO_GIT
from tests.test_simulated_repositories import API_COMMIT


def counts(engine: Engine) -> tuple[int, ...]:
    with DbSession(engine) as db:
        return tuple(
            db.scalar(select(func.count()).select_from(table)) or 0
            for table in (
                User,
                Organization,
                OrganizationMember,
                Session,
                GitHubInstallation,
                Repository,
                RepositoryAnalysis,
            )
        )


def test_the_seed_can_run_again_without_duplicating(
    database_url: str, engine: Engine
) -> None:
    settings = Settings(environment="test", database_url=database_url)
    seed(engine, settings)
    first = counts(engine)
    seed(engine, settings)
    assert counts(engine) == first
    users, organizations, members, sessions, installations, repos, analyses = first
    assert users >= 5 and organizations >= 1 and members >= 4 and sessions >= 4
    assert installations >= 1 and repos >= 5 and analyses >= 4


def test_the_seed_refuses_outside_development_and_test(
    database_url: str, engine: Engine
) -> None:
    settings = Settings(
        environment="staging",
        database_url=database_url,
        redis_url="redis://queue:6379/0",
    )
    with pytest.raises(SettingsError, match="development and test"):
        seed(engine, settings)


def test_what_is_seeded_about_a_repository_was_found_by_reading_it(
    database_url: str, engine: Engine, tmp_path: Path
) -> None:
    """The seed says nothing about a repository that indexing it would not."""
    root = tmp_path / "workspaces"
    seed(
        engine,
        Settings(
            environment="test", database_url=database_url, workspace_root=str(root)
        ),
    )
    # Cloned there, and gone again.
    assert os.listdir(root) == []
    with DbSession(engine) as db:
        organization = db.scalars(
            select(Organization).where(Organization.slug == "ayinde-creations")
        ).one()
        stored = {
            repo.github_id: repo
            for repo in db.scalars(
                select(Repository).where(Repository.organization_id == organization.id)
            )
        }
        for github_id, full_name, _, _, status, message, was_indexed in REPOSITORIES:
            repo = stored[github_id]
            assert (repo.full_name, repo.status, repo.status_message) == (
                full_name,
                status,
                message,
            )
            # Nobody is indexing it, and nobody is to.
            assert repo.index_worker_id is None and repo.index_heartbeat_at is None
            assert repo.index_dispatched_at is None and repo.index_attempts == 0
            analyses = db.scalars(
                select(RepositoryAnalysis).where(
                    RepositoryAnalysis.repository_id == repo.id
                )
            ).all()
            if not was_indexed:
                assert repo.last_analyzed_commit is None
                assert repo.last_analyzed_at is None
                assert repo.languages == [] and analyses == []
                continue
            copy = tmp_path / str(github_id)
            commit = materialise(full_name, copy)
            shutil.rmtree(copy / ".git")
            expected = inspect_tree(copy)
            assert repo.last_analyzed_commit == commit
            assert repo.languages == expected.languages
            [analysis] = analyses
            assert (analysis.commit, analysis.summary) == (commit, expected.summary)
            assert analysis.data == expected.data
            assert analysis.analyzed_at == repo.last_analyzed_at
        by_name = {repo.full_name: repo for repo in stored.values()}
        assert by_name["forgemind/api"].last_analyzed_commit == API_COMMIT
        assert by_name["acme/payments"].status_message == SUSPENDED
        assert by_name["acme/legacy-portal"].status == "revoked"


def test_a_seed_that_cannot_read_a_repository_says_so_and_seeds_nothing(
    database_url: str,
    engine: Engine,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seed(engine, Settings(environment="test", database_url=database_url))
    before = counts(engine)

    def no_git(full_name: str, directory: Path) -> str:
        raise simulated_repositories.GitMissing("git is needed")

    monkeypatch.setattr(simulated_repositories, "materialise", no_git)
    root = tmp_path / "workspaces"
    settings = Settings(
        environment="test", database_url=database_url, workspace_root=str(root)
    )
    with pytest.raises(SettingsError) as refused:
        seed(engine, settings)
    assert str(refused.value) == f"the seed could not index forgemind/api: {NO_GIT}"
    assert counts(engine) == before
    assert os.listdir(root) == []
