"""The simulated GitHub's repositories: made-up files, really committed, and
inspected like any other repository."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from forgemind_api.github import SIMULATED_ACCOUNTS
from forgemind_api.inspection import inspect_tree
from forgemind_api.simulated_repositories import TREES, materialise
from tests.gitrepos import git

# The commit `forgemind/api` is, on any machine, for as long as its files and
# the way they are committed stay the same.
API_COMMIT = "3636e5e228b4dd45a11806f46d797e2cb3754854"

# What the inspection finds in each: its main language, frameworks, entry
# points, test commands and build commands.
FOUND: dict[str, tuple[str, list[str], list[tuple[str, str]], list[str], list[str]]] = {
    "forgemind/api": (
        "TypeScript",
        ["Drizzle", "Hono", "Vitest", "GitHub Actions"],
        [("src/server.ts", "server")],
        ["pnpm test"],
        ["pnpm build"],
    ),
    "forgemind/web": (
        "TypeScript",
        ["Next.js", "React", "Playwright", "Tailwind CSS", "Vitest"],
        [("src/app/layout.tsx", "web")],
        ["pnpm test"],
        ["pnpm build"],
    ),
    "forgemind/workers": (
        "Python",
        ["Celery", "Pydantic", "pytest", "Docker"],
        [
            ("src/workers/cli.py", "cli"),
            ("src/workers/celery_app.py", "worker"),
            ("src/workers/tasks.py", "worker"),
        ],
        ["uv run pytest"],
        ["uv build"],
    ),
    "acme/payments": (
        "Go",
        ["chi", "Terraform"],
        [("cmd/payments/main.go", "server")],
        ["go test ./...", "make test"],
        ["go build ./...", "make build"],
    ),
    "acme/legacy-portal": ("PHP", [], [("public/index.php", "web")], [], []),
    "forgemind/docs": ("MDX", ["Next.js", "Nextra", "React"], [], [], ["pnpm build"]),
    "forgemind/infra": ("HCL", ["Terraform", "GitHub Actions"], [], [], []),
    "forgemind/cli": (
        "TypeScript",
        ["Vitest"],
        [("src/cli.ts", "cli"), ("install.sh", "cli")],
        ["pnpm test"],
        ["pnpm build"],
    ),
    "samrivera/notes-api": (
        "TypeScript",
        ["Express", "Jest"],
        [("src/index.ts", "server")],
        ["npm test"],
        ["npm run build"],
    ),
    "samrivera/shop-web": (
        "TypeScript",
        ["React", "Vite", "Vitest"],
        [("src/main.tsx", "web")],
        ["npm test"],
        ["npm run build"],
    ),
    "samrivera/data-pipeline": (
        "Python",
        ["Click", "pandas", "SQLAlchemy", "pytest"],
        [("pipeline/__main__.py", "cli")],
        ["pytest", "make test"],
        [],
    ),
    "samrivera/dotfiles": (
        "Lua",
        [],
        [("install.sh", "cli"), ("bin/git-prune-merged", "cli")],
        [],
        [],
    ),
    "samrivera/legacy-cms": (
        "PHP",
        ["Slim", "PHPUnit"],
        [("index.php", "web")],
        ["composer test"],
        [],
    ),
}


def modes(repository: Path) -> dict[str, str]:
    """Each committed file's mode, as git recorded it."""
    listed: dict[str, str] = {}
    for line in git(repository, "ls-tree", "-r", "HEAD").splitlines():
        details, _, path = line.partition("\t")
        listed[path] = details.split()[0]
    return listed


def test_every_repository_the_simulated_github_lists_has_files_and_no_other() -> None:
    listed = {
        repo.full_name
        for account in SIMULATED_ACCOUNTS.values()
        for repo in account.repositories
    }
    assert listed == set(TREES) == set(FOUND)
    assert all(tree for tree in TREES.values())


@pytest.mark.parametrize("full_name", sorted(TREES))
def test_a_repository_is_one_commit_on_main_holding_exactly_its_files(
    full_name: str, tmp_path: Path
) -> None:
    repository = tmp_path / "repository"
    commit = materialise(full_name, repository)
    assert git(repository, "rev-parse", "HEAD") == commit
    assert git(repository, "rev-list", "--count", "HEAD") == "1"
    assert git(repository, "symbolic-ref", "--short", "HEAD") == "main"
    assert git(repository, "status", "--porcelain") == ""
    assert git(repository, "log", "-1", "--format=%s") == f"Import {full_name}"
    tree = TREES[full_name]
    assert set(modes(repository)) == set(tree)
    for path, content in tree.items():
        assert (repository / path).read_text() == content, path


@pytest.mark.parametrize("full_name", sorted(TREES))
def test_scripts_are_committed_executable_and_nothing_else_is(
    full_name: str, tmp_path: Path
) -> None:
    repository = tmp_path / "repository"
    materialise(full_name, repository)
    for path, mode in modes(repository).items():
        script = TREES[full_name][path].startswith("#!")
        assert mode == ("100755" if script else "100644"), path


def test_some_repository_has_a_script_to_be_executable() -> None:
    assert TREES["samrivera/dotfiles"]["bin/git-prune-merged"].startswith("#!")


def test_a_repository_is_the_same_commit_every_time(tmp_path: Path) -> None:
    first = materialise("forgemind/api", tmp_path / "one")
    second = materialise("forgemind/api", tmp_path / "two")
    assert first == second == API_COMMIT


def test_nothing_of_this_machine_or_account_changes_the_commit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    home = tmp_path / "home"
    home.mkdir()
    # Read, this configuration would change the author, and would stop the
    # commit altogether for want of a key to sign it with.
    (home / ".gitconfig").write_text(
        "[user]\n\tname = Somebody Else\n\temail = else@example.com\n"
        "[commit]\n\tgpgsign = true\n[core]\n\tautocrlf = true\n"
    )
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("GIT_AUTHOR_NAME", "Somebody Else")
    monkeypatch.setenv("GIT_COMMITTER_DATE", "2001-01-01T00:00:00+00:00")
    monkeypatch.setenv("GIT_DIR", str(tmp_path / "elsewhere.git"))
    repository = tmp_path / "repository"
    assert materialise("forgemind/api", repository) == API_COMMIT
    assert not (tmp_path / "elsewhere.git").exists()
    # A format of our own: git's ISO one writes UTC as "+00:00" or as "Z",
    # depending on its version.
    when = "--date=format:%Y-%m-%dT%H:%M:%S%z"
    assert (
        git(repository, "log", "-1", when, "--format=%an <%ae> %ad | %cn <%ce> %cd")
        == "Simulated GitHub <simulated@forgemind.invalid> 2026-10-01T09:00:00+0000"
        " | Simulated GitHub <simulated@forgemind.invalid> 2026-10-01T09:00:00+0000"
    )


@pytest.mark.parametrize("full_name", sorted(FOUND))
def test_what_the_inspection_finds_in_each(full_name: str, tmp_path: Path) -> None:
    repository = tmp_path / "repository"
    materialise(full_name, repository)
    found = inspect_tree(repository)
    data: dict[str, Any] = found.data
    language, frameworks, entry_points, tests, builds = FOUND[full_name]
    assert found.languages[0]["name"] == language
    # Shares are rounded to a tenth of a percent each.
    assert abs(sum(entry["share"] for entry in found.languages) - 1) < 0.005
    assert data["frameworks"] == frameworks
    assert [(e["path"], e["kind"]) for e in data["entryPoints"]] == entry_points
    assert data["testCommands"] == tests
    assert data["buildCommands"] == builds
    # What is named is there to be opened.
    for entry in data["entryPoints"]:
        assert entry["path"] in TREES[full_name]
    for document in data["documentation"]:
        assert document["path"] in TREES[full_name]
    for concern in data["concerns"]:
        for evidence in concern["evidence"]:
            assert evidence["path"] in TREES[full_name]
    assert "nothing in the repository was run" in found.summary


def test_a_repository_without_tests_or_a_lockfile_is_said_to_be_so(
    tmp_path: Path,
) -> None:
    repository = tmp_path / "repository"
    materialise("acme/legacy-portal", repository)
    concerns = inspect_tree(repository).data["concerns"]
    assert [concern["title"] for concern in concerns] == [
        "No test command was found",
        "Dependencies are not pinned by a lockfile",
    ]
    assert concerns[1]["evidence"] == [{"path": "composer.json", "line": 4}]
