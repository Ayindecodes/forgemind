"""Reads a checked-out repository and says what is in it: its languages and
frameworks, where it starts, how it is laid out, what it depends on, how it
is tested and built, its documentation, and what looks weak.

Everything here comes from reading files. Nothing in the repository is run,
imported or installed, and no link out of the tree is followed. What it says
is measured or declared: where a judgement is made, such as how much a
directory matters, the measurement behind it is given with it."""

from __future__ import annotations

import json
import os
import re
import stat
import tomllib
import unicodedata
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

# The most files one inspection looks at, and the most it reads of any one.
MAX_FILES = 50_000
MAX_READ_BYTES = 1_000_000
HEAD_BYTES = 64_000

MAX_MANIFESTS = 40
MAX_DEPENDENCIES = 300
MAX_COMMANDS = 10
MAX_ENTRY_POINTS = 12
MAX_MODULES = 12
MAX_DOCUMENTS = 20
MAX_FRAMEWORKS = 16
MAX_LANGUAGES = 8
MAX_EVIDENCE = 5

# Other people's code and build output: not this repository's own work.
IGNORED_DIRECTORIES = frozenset(
    {
        ".git",
        "node_modules",
        "bower_components",
        "vendor",
        "third_party",
        "dist",
        "build",
        "target",
        "coverage",
        "__pycache__",
        ".venv",
        "venv",
        ".tox",
        ".next",
    }
)

SUFFIX_LANGUAGES: dict[str, str] = {
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".mts": "TypeScript",
    ".cts": "TypeScript",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".mjs": "JavaScript",
    ".cjs": "JavaScript",
    ".py": "Python",
    ".go": "Go",
    ".rs": "Rust",
    ".java": "Java",
    ".kt": "Kotlin",
    ".kts": "Kotlin",
    ".scala": "Scala",
    ".rb": "Ruby",
    ".php": "PHP",
    ".cs": "C#",
    ".c": "C",
    ".h": "C",
    ".cc": "C++",
    ".cpp": "C++",
    ".hpp": "C++",
    ".swift": "Swift",
    ".dart": "Dart",
    ".ex": "Elixir",
    ".exs": "Elixir",
    ".lua": "Lua",
    ".pl": "Perl",
    ".r": "R",
    ".sh": "Shell",
    ".bash": "Shell",
    ".zsh": "Shell",
    ".sql": "SQL",
    ".css": "CSS",
    ".scss": "SCSS",
    ".less": "Less",
    ".html": "HTML",
    ".vue": "Vue",
    ".svelte": "Svelte",
    ".mdx": "MDX",
    ".tf": "HCL",
    ".hcl": "HCL",
}
NAMED_LANGUAGES: dict[str, str] = {
    "Dockerfile": "Dockerfile",
    "Containerfile": "Dockerfile",
    "Makefile": "Makefile",
    "GNUmakefile": "Makefile",
    "Gemfile": "Ruby",
    "Rakefile": "Ruby",
}

NPM_FRAMEWORKS: dict[str, str] = {
    "next": "Next.js",
    "react": "React",
    "vue": "Vue",
    "nuxt": "Nuxt",
    "svelte": "Svelte",
    "@sveltejs/kit": "SvelteKit",
    "@angular/core": "Angular",
    "astro": "Astro",
    "@remix-run/react": "Remix",
    "express": "Express",
    "fastify": "Fastify",
    "hono": "Hono",
    "koa": "Koa",
    "@nestjs/core": "NestJS",
    "electron": "Electron",
    "vite": "Vite",
    "tailwindcss": "Tailwind CSS",
    "prisma": "Prisma",
    "@prisma/client": "Prisma",
    "drizzle-orm": "Drizzle",
    "typeorm": "TypeORM",
    "@docusaurus/core": "Docusaurus",
    "nextra": "Nextra",
    "vitest": "Vitest",
    "jest": "Jest",
    "mocha": "Mocha",
    "@playwright/test": "Playwright",
    "cypress": "Cypress",
}
PYPI_FRAMEWORKS: dict[str, str] = {
    "fastapi": "FastAPI",
    "django": "Django",
    "flask": "Flask",
    "starlette": "Starlette",
    "celery": "Celery",
    "apache-airflow": "Apache Airflow",
    "prefect": "Prefect",
    "dagster": "Dagster",
    "sqlalchemy": "SQLAlchemy",
    "alembic": "Alembic",
    "pydantic": "Pydantic",
    "pandas": "pandas",
    "typer": "Typer",
    "click": "Click",
    "pytest": "pytest",
}
# Matched as prefixes: a Go module path may end in a major version.
GO_FRAMEWORKS: dict[str, str] = {
    "github.com/gin-gonic/gin": "Gin",
    "github.com/labstack/echo": "Echo",
    "github.com/go-chi/chi": "chi",
    "github.com/gofiber/fiber": "Fiber",
    "google.golang.org/grpc": "gRPC",
    "gorm.io/gorm": "GORM",
    "github.com/spf13/cobra": "Cobra",
}
CARGO_FRAMEWORKS: dict[str, str] = {
    "axum": "Axum",
    "actix-web": "Actix Web",
    "rocket": "Rocket",
    "warp": "warp",
    "tonic": "tonic",
    "tokio": "Tokio",
    "clap": "clap",
}
COMPOSER_FRAMEWORKS: dict[str, str] = {
    "laravel/framework": "Laravel",
    "symfony/framework-bundle": "Symfony",
    "slim/slim": "Slim",
    "phpunit/phpunit": "PHPUnit",
}
GEM_FRAMEWORKS: dict[str, str] = {
    "rails": "Rails",
    "sinatra": "Sinatra",
    "rspec": "RSpec",
    "rspec-rails": "RSpec",
}

# A dependency on one of these means the package serves requests.
NODE_SERVERS = frozenset(
    {"express", "fastify", "hono", "koa", "@nestjs/core", "@hapi/hapi", "restify"}
)
PYTHON_SERVERS = frozenset(
    {"fastapi", "django", "flask", "starlette", "aiohttp", "tornado", "sanic"}
)
RUST_SERVERS = frozenset({"axum", "actix-web", "rocket", "warp", "tonic"})
CELERY_FILES = frozenset({"worker.py", "tasks.py", "celery.py", "celery_app.py"})
# What a Go program that serves requests imports.
GO_SERVES = (
    '"net/http"',
    '"github.com/gin-gonic/gin',
    '"github.com/labstack/echo',
    '"github.com/go-chi/chi',
    '"github.com/gofiber/fiber',
    '"google.golang.org/grpc',
)

NODE_LOCKS = (
    "pnpm-lock.yaml",
    "yarn.lock",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "bun.lock",
    "bun.lockb",
)
PYTHON_LOCKS = ("uv.lock", "poetry.lock", "pdm.lock", "Pipfile.lock")

# Directories that hold a repository's parts instead of being one.
CONTAINERS = frozenset(
    {
        "src",
        "apps",
        "packages",
        "services",
        "libs",
        "cmd",
        "internal",
        "pkg",
        "crates",
        "modules",
        "plugins",
    }
)
# Directories that support the work without being it.
PERIPHERAL = frozenset(
    {
        "test",
        "tests",
        "__tests__",
        "e2e",
        "spec",
        "specs",
        "fixtures",
        "doc",
        "docs",
        "example",
        "examples",
        "samples",
        "benchmarks",
        "scripts",
        "tools",
    }
)

MANIFEST_NAMES = frozenset(
    {
        "package.json",
        "pyproject.toml",
        "go.mod",
        "Cargo.toml",
        "composer.json",
        "Gemfile",
        "pom.xml",
        "build.gradle",
        "build.gradle.kts",
        "Makefile",
    }
)
REQUIREMENTS = re.compile(r"^requirements([-_.][\w.-]+)?\.txt$")
SAFE_DIRECTORY = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_./-]*$")
REQUIREMENT = re.compile(
    r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*([^;#]*)"
)
SCRIPT_FILE = re.compile(r"[\w@./-]+\.[cm]?[jt]sx?\b")
MAKE_TARGET = re.compile(r"^([A-Za-z0-9_.-]+)\s*:(?!=)", re.MULTILINE)
GEM = re.compile(r"""^\s*gem\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?""")
HTML_TITLE = re.compile(r"<h1[^>]*>(.*?)</h1>", re.IGNORECASE | re.DOTALL)
TAG = re.compile(r"<[^>]+>")
MARKDOWN_LINK = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")
# Markdown's emphasis marks; an underscore inside a word is left alone.
EMPHASIS = re.compile(
    r"(\*{1,3})(?=\S)(.+?)(?<=\S)\1|(?<!\w)(_{1,3})(?=\S)(.+?)(?<=\S)\3(?!\w)"
)


@dataclass(frozen=True)
class Inspection:
    """What one inspection found. `data` is the rest of the contract's
    analysis: frameworks, entryPoints, modules, dependencies, testCommands,
    buildCommands, documentation and concerns."""

    languages: list[dict[str, Any]]
    summary: str
    data: dict[str, Any]


@dataclass(frozen=True)
class Tree:
    """The regular files of a checkout, by path from its top, with `/`."""

    root: Path
    sizes: dict[str, int]
    executable: frozenset[str]
    # Each directory that holds a file, with the directories directly in it.
    children: dict[str, list[str]]
    truncated: bool

    def has(self, path: str) -> bool:
        return path in self.sizes

    def first(self, *paths: str) -> str | None:
        return next((path for path in paths if path in self.sizes), None)

    def read(self, path: str, limit: int = MAX_READ_BYTES) -> str | None:
        """The start of a file as text. None if it is not one of the files
        the scan found, or cannot be opened without following a link."""
        if path not in self.sizes:
            return None
        try:
            descriptor = os.open(self.root / path, os.O_RDONLY | os.O_NOFOLLOW)
        except OSError:
            return None
        with os.fdopen(descriptor, "rb") as handle:
            return handle.read(limit).decode("utf-8", "replace")

    def below(self, directory: str) -> Iterator[str]:
        if not directory:
            yield from self.sizes
            return
        prefix = f"{directory}/"
        for path in self.sizes:
            if path.startswith(prefix):
                yield path


def scan(root: Path, max_files: int = MAX_FILES) -> Tree:
    """Lists the regular files under `root`. Links are not followed and not
    listed, whatever they point at, so nothing outside the checkout is read."""
    sizes: dict[str, int] = {}
    executable: set[str] = set()
    directories: set[str] = set()
    truncated = False
    top = str(root)
    for current, names, files in os.walk(top, followlinks=False):
        names[:] = sorted(
            name
            for name in names
            if name not in IGNORED_DIRECTORIES
            and not os.path.islink(os.path.join(current, name))
        )
        relative = os.path.relpath(current, top).replace(os.sep, "/")
        here = "" if relative == "." else relative
        for name in sorted(files):
            try:
                found = os.lstat(os.path.join(current, name))
            except OSError:
                continue
            path = join(here, name)
            if not stat.S_ISREG(found.st_mode) or not printable(path):
                continue
            if len(sizes) >= max_files:
                truncated = True
                break
            sizes[path] = found.st_size
            if found.st_mode & 0o111:
                executable.add(path)
            directories.update(ancestors(path))
        if truncated:
            break
    children: dict[str, list[str]] = {}
    for directory in sorted(directories):
        children.setdefault(parent(directory), []).append(directory)
    return Tree(root, sizes, frozenset(executable), children, truncated)


def inspect_tree(root: Path, max_files: int = MAX_FILES) -> Inspection:
    """Inspects the checkout at `root`."""
    tree = scan(root, max_files)
    code = {
        path: language
        for path in tree.sizes
        if (language := language_of(path)) is not None
    }
    reading = Reading(tree)
    reading.read_all()
    languages = language_shares(tree, code)
    modules = module_list(tree, code)
    documentation = documents(tree)
    data: dict[str, Any] = {
        "frameworks": reading.frameworks[:MAX_FRAMEWORKS],
        "entryPoints": [
            {"path": path, "kind": kind}
            for path, kind in list(reading.entries.items())[:MAX_ENTRY_POINTS]
        ],
        "modules": modules,
        "dependencies": [
            {
                "name": name,
                "version": version,
                "ecosystem": ecosystem,
                # Nothing here consults an advisory database, so nothing here
                # can call a dependency vulnerable.
                "vulnerable": False,
                "advisoryUrl": None,
            }
            for (ecosystem, name), version in list(reading.dependencies.items())[
                :MAX_DEPENDENCIES
            ]
        ],
        "testCommands": reading.tests[:MAX_COMMANDS],
        "buildCommands": reading.builds[:MAX_COMMANDS],
        "documentation": documentation,
        "concerns": reading.concerns(),
    }
    return Inspection(
        languages=languages,
        summary=summarise(tree, code, languages, reading),
        data=data,
    )


# --- small things about paths and text


def join(directory: str, name: str) -> str:
    return f"{directory}/{name}" if directory else name


def parent(path: str) -> str:
    return path.rpartition("/")[0]


def basename(path: str) -> str:
    return path.rpartition("/")[2]


def ancestors(path: str) -> Iterator[str]:
    while path := parent(path):
        yield path


def printable(text: str) -> bool:
    """False for a path that holds control or formatting characters, or bytes
    that are not text: it could not be shown or linked to as it is."""
    return all(unicodedata.category(char)[0] != "C" for char in text)


def clean(text: str, limit: int = 200) -> str:
    """Text from a repository made safe to store and show: one line, without
    control or direction-changing characters, and no longer than `limit`."""
    kept = "".join(
        " " if char.isspace() else char
        for char in text
        if char.isspace() or unicodedata.category(char)[0] != "C"
    )
    return " ".join(kept.split())[:limit]


def mapping(value: object) -> dict[str, Any]:
    """A parsed object as a mapping; anything else is empty."""
    return cast(dict[str, Any], value) if isinstance(value, dict) else {}


def strings(value: object) -> dict[str, str]:
    """The entries of a parsed object whose values are strings."""
    return {
        str(key): item for key, item in mapping(value).items() if isinstance(item, str)
    }


def listing(value: object) -> list[Any]:
    return cast(list[Any], value) if isinstance(value, list) else []


def line_of(text: str, needle: str) -> int | None:
    """The first line of `text` that holds `needle`, counted from one."""
    for number, line in enumerate(text.splitlines(), start=1):
        if needle in line:
            return number
    return None


def plural(count: int, noun: str, many: str | None = None) -> str:
    return f"{count:,} {noun if count == 1 else many or noun + 's'}"


def percent(share: float) -> str:
    if share <= 0:
        return "0%"
    return "less than 1%" if share < 0.01 else f"{round(share * 100)}%"


def amount(size: int) -> str:
    if size < 1000:
        return f"{size} bytes"
    if size < 1_000_000:
        return f"{size / 1000:.0f} kB"
    return f"{size / 1_000_000:.1f} MB"


def series(names: list[str]) -> str:
    if len(names) < 2:
        return "".join(names)
    return f"{', '.join(names[:-1])} and {names[-1]}"


# --- languages


def language_of(path: str) -> str | None:
    name = basename(path)
    if name in NAMED_LANGUAGES:
        return NAMED_LANGUAGES[name]
    if name.startswith("Dockerfile."):
        return "Dockerfile"
    if name.endswith((".min.js", ".min.css")):
        return None
    return SUFFIX_LANGUAGES.get(os.path.splitext(name)[1].lower())


def language_shares(tree: Tree, code: dict[str, str]) -> list[dict[str, Any]]:
    """Each language's share of the code, by size, largest first. A share
    too small to show as one in a hundred is left out."""
    totals: dict[str, int] = {}
    for path, language in code.items():
        totals[language] = totals.get(language, 0) + tree.sizes[path]
    whole = sum(totals.values())
    if whole == 0:
        return []
    ranked = sorted(totals.items(), key=lambda item: (-item[1], item[0]))
    return [
        {"name": name, "share": round(size / whole, 3)}
        for name, size in ranked[:MAX_LANGUAGES]
        if size / whole >= 0.005
    ]


# --- manifests: frameworks, dependencies, commands, entry points, concerns


@dataclass
class Unlocked:
    """A manifest whose dependencies no lockfile pins."""

    path: str
    lines: list[int | None]


class Reading:
    """What the manifests and the conventional files say."""

    def __init__(self, tree: Tree) -> None:
        self.tree = tree
        self.frameworks: list[str] = []
        self.dependencies: dict[tuple[str, str], str] = {}
        self.tests: list[str] = []
        self.builds: list[str] = []
        self.entries: dict[str, str] = {}
        self.manifests: list[str] = []
        # Manifests that declare how the code is run, and the line that
        # would hold a test command if there were one.
        self.runnable: list[tuple[str, int | None]] = []
        self.unlocked: list[Unlocked] = []
        self.unreadable: list[tuple[str, str]] = []

    def read_all(self) -> None:
        for path in self.manifest_paths():
            directory, name = parent(path), basename(path)
            self.manifests.append(path)
            if name == "package.json":
                self.node(path, directory)
            elif name == "pyproject.toml" or REQUIREMENTS.match(name):
                self.python(directory)
            elif name == "go.mod":
                self.go(path, directory)
            elif name == "Cargo.toml":
                self.rust(path, directory)
            elif name == "composer.json":
                self.php(path, directory)
            elif name == "Gemfile":
                self.ruby(path, directory)
            elif name == "pom.xml":
                self.command(self.tests, directory, "mvn test")
                self.command(self.builds, directory, "mvn package")
            elif name.startswith("build.gradle"):
                gradle = (
                    "./gradlew"
                    if self.tree.has(join(directory, "gradlew"))
                    else "gradle"
                )
                self.command(self.tests, directory, f"{gradle} test")
                self.command(self.builds, directory, f"{gradle} build")
            elif name == "Makefile":
                self.make(path, directory)
        self.conventions()

    def manifest_paths(self) -> list[str]:
        """The manifests to read, nearest the top first. Several Python
        manifests in one directory are read together, as one."""
        found: list[str] = []
        python: set[str] = set()
        for path in self.tree.sizes:
            name = basename(path)
            if path.count("/") > 4:
                continue
            if name in ("pyproject.toml",) or REQUIREMENTS.match(name):
                if parent(path) in python:
                    continue
                python.add(parent(path))
                found.append(path)
            elif name in MANIFEST_NAMES:
                found.append(path)
        # A Makefile after the manifest beside it: that one says more.
        found.sort(
            key=lambda path: (
                path.count("/"),
                parent(path),
                basename(path) == "Makefile",
                path,
            )
        )
        return found[:MAX_MANIFESTS]

    # - what a manifest adds

    def framework(self, name: str | None) -> None:
        if name and name not in self.frameworks:
            self.frameworks.append(name)

    def dependency(self, ecosystem: str, name: str, version: str) -> None:
        name, version = clean(name, 120), clean(version, 60) or "*"
        if name:
            self.dependencies.setdefault((ecosystem, name), version)

    def command(self, commands: list[str], directory: str, command: str) -> None:
        """Adds a command, to be run from `directory`. A directory whose
        name would not be safe on a command line is left out."""
        if directory:
            if not SAFE_DIRECTORY.match(directory):
                return
            command = f"cd {directory} && {command}"
        if command not in commands:
            commands.append(command)

    def entry(self, path: str | None, kind: str) -> None:
        if path is not None and self.tree.has(path):
            self.entries.setdefault(path, kind)

    def parsed(self, path: str, form: str) -> dict[str, Any] | None:
        """The manifest at `path`, or None, noted, if it cannot be parsed."""
        text = self.tree.read(path)
        if text is None:
            return None
        try:
            if form == "JSON":
                return mapping(json.loads(text))
            return tomllib.loads(text)
        except (ValueError, RecursionError):
            self.unreadable.append((path, form))
            return None

    # - JavaScript and TypeScript

    def node(self, path: str, directory: str) -> None:
        data = self.parsed(path, "JSON")
        if data is None:
            return
        text = self.tree.read(path) or ""
        declared = {
            **strings(data.get("dependencies")),
            **strings(data.get("devDependencies")),
        }
        external = {
            name: version
            for name, version in declared.items()
            if not version.startswith(("workspace:", "link:", "file:", "portal:"))
        }
        for name, version in external.items():
            self.dependency("npm", name, version)
            self.framework(NPM_FRAMEWORKS.get(name))
        manager = self.package_manager(directory, data)
        run = f"{manager} run" if manager in ("npm", "bun") else manager
        scripts = strings(data.get("scripts"))
        test = scripts.get("test", "")
        if test and "no test specified" not in test:
            self.command(
                self.tests,
                directory,
                f"{manager} test" if manager != "bun" else "bun run test",
            )
        if "build" in scripts:
            self.command(self.builds, directory, f"{run} build")
        if scripts or external:
            self.runnable.append((path, line_of(text, '"scripts"')))
        if external and not self.locked(directory, NODE_LOCKS):
            self.unlocked.append(
                Unlocked(
                    path,
                    [
                        line_of(text, '"dependencies"')
                        or line_of(text, '"devDependencies"')
                    ],
                )
            )
        self.node_entries(directory, data, scripts, set(declared))

    def package_manager(self, directory: str, data: dict[str, Any]) -> str:
        declared = data.get("packageManager")
        if not isinstance(declared, str) and directory:
            top = self.tree.read("package.json")
            try:
                declared = mapping(json.loads(top or "{}")).get("packageManager")
            except (ValueError, RecursionError):
                declared = None
        if isinstance(declared, str):
            name = declared.split("@")[0]
            if name in ("pnpm", "yarn", "npm", "bun"):
                return name
        for lock, name in (
            ("pnpm-lock.yaml", "pnpm"),
            ("yarn.lock", "yarn"),
            ("bun.lock", "bun"),
            ("bun.lockb", "bun"),
        ):
            if self.locked(directory, (lock,)):
                return name
        return "npm"

    def locked(self, directory: str, locks: Iterable[str]) -> bool:
        """True when one of `locks` is in `directory` or above it."""
        places = [directory, *ancestors(directory), ""] if directory else [""]
        return any(
            self.tree.has(join(place, lock)) for place in places for lock in locks
        )

    def node_source(self, directory: str, target: str) -> str | None:
        """The file in the tree that `target` names, or is built from."""
        target = target.removeprefix("./")
        stem, extension = os.path.splitext(target)
        candidates = [target]
        for built in ("dist/", "build/", "lib/", "out/"):
            if stem.startswith(built):
                inner = stem[len(built) :]
                for suffix in (".ts", ".tsx", ".mts", ".js", ".mjs"):
                    candidates += [f"src/{inner}{suffix}", f"{inner}{suffix}"]
        if extension in (".js", ".mjs", ".cjs"):
            candidates += [f"{stem}.ts", f"{stem}.tsx", f"{stem}.mts"]
        return self.tree.first(*(join(directory, found) for found in candidates))

    def node_entries(
        self,
        directory: str,
        data: dict[str, Any],
        scripts: dict[str, str],
        declared: set[str],
    ) -> None:
        def here(*names: str) -> str | None:
            return self.tree.first(*(join(directory, name) for name in names))

        serves = bool(declared & NODE_SERVERS)
        binaries = data.get("bin")
        targets = (
            [binaries] if isinstance(binaries, str) else strings(binaries).values()
        )
        for target in targets:
            self.entry(self.node_source(directory, target), "cli")
        if "next" in declared:
            self.entry(
                here(
                    *(
                        f"{base}/{name}.{suffix}"
                        for base, name in (
                            ("src/app", "layout"),
                            ("app", "layout"),
                            ("src/pages", "_app"),
                            ("pages", "_app"),
                            ("src/pages", "index"),
                            ("pages", "index"),
                        )
                        for suffix in ("tsx", "jsx", "ts", "js")
                    )
                ),
                "web",
            )
        elif self.tree.has(join(directory, "index.html")):
            self.entry(
                here("src/main.tsx", "src/main.ts", "src/main.jsx", "src/main.js"),
                "web",
            )
        started = False
        for name in ("start", "dev"):
            for token in SCRIPT_FILE.findall(scripts.get(name, "")):
                found = self.node_source(directory, token)
                if found is None:
                    continue
                if "worker" in basename(found):
                    self.entry(found, "worker")
                else:
                    started = True
                    self.entry(found, "server" if serves else "cli")
        if serves and not started:
            self.entry(
                here(
                    "src/server.ts",
                    "src/server.js",
                    "server.ts",
                    "server.js",
                    "src/main.ts",
                    "src/app.ts",
                    "src/app.js",
                    "src/index.ts",
                    "src/index.js",
                    "app.js",
                    "index.js",
                ),
                "server",
            )
        self.entry(
            here("src/worker.ts", "src/worker.js", "worker.ts", "worker.js"), "worker"
        )
        exports = data.get("exports")
        root_export = mapping(exports).get(".", exports)
        chosen: object = data.get("main") or data.get("module") or root_export
        if not isinstance(chosen, str):
            options = strings(chosen)
            chosen = (
                options.get("import")
                or options.get("default")
                or options.get("require")
            )
        if isinstance(chosen, str):
            self.entry(self.node_source(directory, chosen), "library")

    # - Python

    def python(self, directory: str) -> None:
        declared: dict[str, str] = {}
        names: set[str] = set()

        def declare(requirement: str) -> tuple[str, str] | None:
            match = REQUIREMENT.match(requirement)
            if match is None:
                return None
            name, version = match.group(1), "".join(match.group(2).split())
            declared.setdefault(name, version)
            names.add(re.sub(r"[-_.]+", "-", name).lower())
            return name, version

        pyproject_path = join(directory, "pyproject.toml")
        pyproject = (
            self.parsed(pyproject_path, "TOML")
            if self.tree.has(pyproject_path)
            else None
        ) or {}
        project = mapping(pyproject.get("project"))
        tool = mapping(pyproject.get("tool"))
        poetry = mapping(tool.get("poetry"))
        groups: list[object] = [
            project.get("dependencies"),
            *mapping(project.get("optional-dependencies")).values(),
            *mapping(pyproject.get("dependency-groups")).values(),
            mapping(tool.get("uv")).get("dev-dependencies"),
        ]
        for group in groups:
            for requirement in listing(group):
                if isinstance(requirement, str):
                    declare(requirement)
        tables = [
            poetry.get("dependencies"),
            poetry.get("dev-dependencies"),
            *(
                mapping(group).get("dependencies")
                for group in mapping(poetry.get("group")).values()
            ),
        ]
        for table in tables:
            for name, spec in mapping(table).items():
                version = (
                    spec if isinstance(spec, str) else mapping(spec).get("version")
                )
                if name != "python":
                    declare(f"{name} {version if isinstance(version, str) else ''}")
        from_pyproject = bool(declared)
        loose: list[tuple[str, int]] = []
        for path in sorted(self.tree.below(directory)):
            if parent(path) != directory or not REQUIREMENTS.match(basename(path)):
                continue
            lines = (self.tree.read(path) or "").splitlines()
            for number, line in enumerate(lines, start=1):
                requirement = line.strip()
                if not requirement or requirement.startswith(("#", "-")):
                    continue
                if "://" in requirement:
                    continue
                found = declare(requirement)
                if found is not None and not found[1].startswith("=="):
                    loose.append((path, number))
        for name, version in declared.items():
            self.dependency("pypi", name, version)
            self.framework(PYPI_FRAMEWORKS.get(re.sub(r"[-_.]+", "-", name).lower()))

        def here(*found: str) -> str | None:
            return self.tree.first(*(join(directory, name) for name in found))

        if here("uv.lock") or "uv" in tool:
            runner, build = "uv run ", "uv build"
        elif here("poetry.lock") or poetry:
            runner, build = "poetry run ", "poetry build"
        elif here("pdm.lock"):
            runner, build = "pdm run ", "pdm build"
        else:
            runner, build = "", "python -m build"
        manage = here("manage.py")
        if (
            "pytest" in names
            or "pytest" in tool
            or here("pytest.ini", "conftest.py", "tests/conftest.py")
        ):
            self.command(self.tests, directory, f"{runner}pytest")
        elif manage and "django" in names:
            self.command(self.tests, directory, f"{runner}python manage.py test")
        elif self.uses_unittest(directory):
            self.command(self.tests, directory, f"{runner}python -m unittest discover")
        if here("tox.ini"):
            self.command(self.tests, directory, "tox")
        if "build-system" in pyproject:
            self.command(self.builds, directory, build)
        text = self.tree.read(pyproject_path) or ""
        if declared or pyproject:
            first = (
                here("pyproject.toml")
                or next((path for path, _ in loose), None)
                or here("requirements.txt")
            )
            if first is not None:
                self.runnable.append((first, None))
        if not self.locked(directory, PYTHON_LOCKS):
            if from_pyproject:
                self.unlocked.append(
                    Unlocked(pyproject_path, [line_of(text, "dependencies")])
                )
            by_file: dict[str, list[int | None]] = {}
            for path, number in loose:
                by_file.setdefault(path, []).append(number)
            for path, numbers in by_file.items():
                self.unlocked.append(Unlocked(path, numbers[:MAX_EVIDENCE]))
        self.python_entries(directory, pyproject, names)

    def uses_unittest(self, directory: str) -> bool:
        """True when one of the first few test files here imports unittest."""
        looked = 0
        for path in self.tree.below(directory):
            name = basename(path)
            if not name.endswith(".py") or not name.startswith("test_"):
                continue
            if "import unittest" in (self.tree.read(path, HEAD_BYTES) or ""):
                return True
            looked += 1
            if looked == 20:
                break
        return False

    def python_entries(
        self, directory: str, pyproject: dict[str, Any], names: set[str]
    ) -> None:
        def here(*found: str) -> str | None:
            return self.tree.first(*(join(directory, name) for name in found))

        scripts = {
            **strings(mapping(pyproject.get("project")).get("scripts")),
            **strings(
                mapping(mapping(pyproject.get("tool")).get("poetry")).get("scripts")
            ),
        }
        for target in scripts.values():
            module = target.split(":")[0].strip().replace(".", "/")
            if not re.fullmatch(r"[\w/]+", module):
                continue
            self.entry(
                here(
                    f"src/{module}.py",
                    f"{module}.py",
                    f"src/{module}/__init__.py",
                    f"{module}/__init__.py",
                ),
                "cli",
            )
        serves = bool(names & PYTHON_SERVERS)
        self.entry(here("manage.py"), "cli")
        depth = directory.count("/") + 1 if directory else 0
        for path in sorted(self.tree.below(directory)):
            name = basename(path)
            if path.count("/") - depth > 3 or not name.endswith(".py"):
                continue
            if name in ("asgi.py", "wsgi.py"):
                self.entry(path, "server")
            elif name == "__main__.py":
                self.entry(path, "cli")
            elif "celery" in names and name in CELERY_FILES:
                # The name alone says little: it has to use Celery as well.
                if "celery" in (self.tree.read(path, HEAD_BYTES) or "").lower():
                    self.entry(path, "worker")
            elif "apache-airflow" in names and basename(parent(path)) == "dags":
                self.entry(path, "worker")
        self.entry(
            here("main.py", "app.py", "src/main.py", "src/app.py", "app/main.py"),
            "server" if serves else "cli",
        )

    # - Go, Rust, PHP, Ruby, Make

    def go(self, path: str, directory: str) -> None:
        text = self.tree.read(path) or ""
        block = False
        first: int | None = None
        for number, raw in enumerate(text.splitlines(), start=1):
            line = raw.strip()
            if line.startswith("require ("):
                block = True
                continue
            if block and line.startswith(")"):
                block = False
                continue
            if line.startswith("require "):
                line = line[len("require ") :]
            elif not block:
                continue
            parts = line.split()
            if len(parts) < 2 or "// indirect" in line:
                continue
            first = first or number
            self.dependency("go", parts[0], parts[1])
            self.framework(
                next(
                    (
                        label
                        for prefix, label in GO_FRAMEWORKS.items()
                        if parts[0].startswith(prefix)
                    ),
                    None,
                )
            )
        self.command(self.tests, directory, "go test ./...")
        self.command(self.builds, directory, "go build ./...")
        self.runnable.append((path, None))
        if first is not None and not self.tree.has(join(directory, "go.sum")):
            self.unlocked.append(Unlocked(path, [first]))
        mains = [join(directory, "main.go")]
        mains += [
            found
            for found in sorted(self.tree.below(join(directory, "cmd")))
            if basename(found) == "main.go"
        ]
        for main in mains:
            source = self.tree.read(main, HEAD_BYTES)
            if source is not None:
                serves = any(sign in source for sign in GO_SERVES)
                self.entry(main, "server" if serves else "cli")

    def rust(self, path: str, directory: str) -> None:
        data = self.parsed(path, "TOML")
        if data is None:
            return
        names: set[str] = set()
        tables = [
            data.get("dependencies"),
            data.get("dev-dependencies"),
            data.get("build-dependencies"),
            mapping(data.get("workspace")).get("dependencies"),
        ]
        for table in tables:
            for name, spec in mapping(table).items():
                version = (
                    spec if isinstance(spec, str) else mapping(spec).get("version")
                )
                if not isinstance(version, str):
                    continue  # a path, a git source, or the workspace's own
                names.add(name)
                self.dependency("cargo", name, version)
                self.framework(CARGO_FRAMEWORKS.get(name))
        self.command(self.tests, directory, "cargo test")
        self.command(self.builds, directory, "cargo build")
        self.runnable.append((path, None))
        main = join(directory, "src/main.rs")
        self.entry(main, "server" if names & RUST_SERVERS else "cli")
        self.entry(join(directory, "src/lib.rs"), "library")
        for found in sorted(self.tree.below(join(directory, "src/bin"))):
            if found.endswith(".rs"):
                self.entry(found, "cli")
        if (
            names
            and self.tree.has(main)
            and not self.locked(directory, ("Cargo.lock",))
        ):
            text = self.tree.read(path) or ""
            self.unlocked.append(Unlocked(path, [line_of(text, "[dependencies]")]))

    def php(self, path: str, directory: str) -> None:
        data = self.parsed(path, "JSON")
        if data is None:
            return
        text = self.tree.read(path) or ""
        declared = {
            name: version
            for name, version in {
                **strings(data.get("require")),
                **strings(data.get("require-dev")),
            }.items()
            if name != "php" and not name.startswith("ext-")
        }
        for name, version in declared.items():
            self.dependency("other", name, version)
            self.framework(COMPOSER_FRAMEWORKS.get(name))
        scripts = mapping(data.get("scripts"))
        if "test" in scripts:
            self.command(self.tests, directory, "composer test")
        elif self.tree.first(
            join(directory, "phpunit.xml"), join(directory, "phpunit.xml.dist")
        ):
            self.command(self.tests, directory, "vendor/bin/phpunit")
        if "build" in scripts:
            self.command(self.builds, directory, "composer build")
        self.runnable.append((path, line_of(text, '"scripts"')))
        if declared and not self.tree.has(join(directory, "composer.lock")):
            self.unlocked.append(Unlocked(path, [line_of(text, '"require"')]))
        self.entry(join(directory, "artisan"), "cli")
        self.entry(join(directory, "bin/console"), "cli")

    def ruby(self, path: str, directory: str) -> None:
        names: set[str] = set()
        for line in (self.tree.read(path) or "").splitlines():
            match = GEM.match(line)
            if match is None:
                continue
            names.add(match.group(1))
            self.dependency("other", match.group(1), match.group(2) or "*")
            self.framework(GEM_FRAMEWORKS.get(match.group(1)))
        if names & {"rspec", "rspec-rails"}:
            self.command(self.tests, directory, "bundle exec rspec")
        elif "rails" in names and self.tree.has(join(directory, "bin/rails")):
            self.command(self.tests, directory, "bin/rails test")
        self.runnable.append((path, None))
        if names and not self.tree.has(join(directory, "Gemfile.lock")):
            self.unlocked.append(Unlocked(path, [None]))
        self.entry(join(directory, "config.ru"), "server")

    def make(self, path: str, directory: str) -> None:
        targets = set(MAKE_TARGET.findall(self.tree.read(path) or ""))
        if "test" in targets:
            self.command(self.tests, directory, "make test")
        if "build" in targets:
            self.command(self.builds, directory, "make build")

    # - what needs no manifest

    def conventions(self) -> None:
        tree = self.tree
        self.entry(tree.first("public/index.php", "index.php"), "web")
        for name in ("install.sh", "setup.sh", "bootstrap.sh"):
            self.entry(name, "cli")
        for path in sorted(tree.below("bin")):
            if parent(path) == "bin" and path in tree.executable:
                self.entry(path, "cli")
        if any(language_of(path) == "Dockerfile" for path in tree.sizes):
            self.framework("Docker")
        if tree.first(
            "compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"
        ):
            self.framework("Docker Compose")
        if any(path.endswith(".tf") for path in tree.sizes):
            self.framework("Terraform")
        if any(
            parent(path) == ".github/workflows" and path.endswith((".yml", ".yaml"))
            for path in tree.sizes
        ):
            self.framework("GitHub Actions")

    def concerns(self) -> list[dict[str, Any]]:
        """Weaknesses the files themselves show, each with where."""
        found: list[dict[str, Any]] = []
        if not self.tests and self.runnable:
            found.append(
                {
                    "title": "No test command was found",
                    "detail": (
                        "Nothing here declares how the tests are run, and no "
                        "test runner's configuration was found, so a change to "
                        "this repository cannot be checked by running its tests."
                    ),
                    "evidence": [
                        {"path": path, "line": line}
                        for path, line in self.runnable[:MAX_EVIDENCE]
                    ],
                }
            )
        if self.unlocked:
            found.append(
                {
                    "title": "Dependencies are not pinned by a lockfile",
                    "detail": (
                        "These manifests declare dependencies and no lockfile "
                        "beside them fixes the versions, so two installs may "
                        "not get the same code."
                    ),
                    "evidence": [
                        {"path": manifest.path, "line": line}
                        for manifest in self.unlocked
                        for line in manifest.lines
                    ][:MAX_EVIDENCE],
                }
            )
        if self.unreadable:
            found.append(
                {
                    "title": "A manifest could not be read",
                    "detail": (
                        "It is not valid "
                        f"{series(sorted({form for _, form in self.unreadable}))}, "
                        f"or is larger than the {amount(MAX_READ_BYTES)} read of "
                        "any one file, so what it declares is missing from "
                        "this analysis."
                    ),
                    "evidence": [
                        {"path": path, "line": None}
                        for path, _ in self.unreadable[:MAX_EVIDENCE]
                    ],
                }
            )
        return found


# --- modules


def module_list(tree: Tree, code: dict[str, str]) -> list[dict[str, Any]]:
    """The directories the repository is made of, each with its measured
    share of the code. How much one matters is read off that share, except
    that tests, documentation and tooling are set apart by their names."""
    total = sum(tree.sizes[path] for path in code)
    # For each directory, the files below it and its code by language.
    counts: dict[str, int] = {}
    weights: dict[str, dict[str, int]] = {}
    for path, size in tree.sizes.items():
        language = code.get(path)
        for directory in ancestors(path):
            counts[directory] = counts.get(directory, 0) + 1
            if language is not None:
                held = weights.setdefault(directory, {})
                held[language] = held.get(language, 0) + size

    def weight(directory: str) -> int:
        return sum(weights.get(directory, {}).values())

    def parts(directory: str) -> list[str]:
        return [
            child
            for child in tree.children.get(directory, [])
            if not basename(child).startswith(".")
        ]

    found: list[str] = []

    def visit(directory: str, depth: int, lone: bool) -> None:
        children = parts(directory)
        container = basename(directory) in CONTAINERS
        inside = sum(weight(child) for child in children)
        whole = weight(directory)
        # Opened up only if its parts hold most of what is in it.
        opens = (
            (container or lone)
            and bool(children)
            and depth < 3
            and (inside * 2 >= whole if whole else container)
        )
        if not opens:
            found.append(directory)
            return
        for child in children:
            visit(child, depth + 1, len(children) == 1)

    for top in parts(""):
        visit(top, 1, False)

    measured: list[tuple[str, int, int, str | None]] = []
    for directory in found:
        by_language = weights.get(directory, {})
        mostly = (
            min(by_language.items(), key=lambda item: (-item[1], item[0]))[0]
            if by_language
            else None
        )
        measured.append((directory, counts[directory], weight(directory), mostly))
    central = [item for item in measured if basename(item[0]) not in PERIPHERAL]
    largest = max((item[2] for item in central), default=0)
    ranks = {"core": 0, "supporting": 1, "peripheral": 2}
    modules: list[tuple[int, int, str, dict[str, Any]]] = []
    for directory, files, size, mostly in measured:
        share = size / total if total else 0.0
        if basename(directory) in PERIPHERAL or size == 0 or share < 0.05:
            importance = "peripheral"
        elif share >= 0.2 or size == largest:
            importance = "core"
        else:
            importance = "supporting"
        description = (
            f"{plural(files, 'file')}, {percent(share)} of the code, mostly {mostly}."
            if mostly
            else f"{plural(files, 'file')}, none of them code."
        )
        modules.append(
            (
                ranks[importance],
                -size,
                directory,
                {
                    "name": basename(directory),
                    "path": directory,
                    "description": description,
                    "importance": importance,
                },
            )
        )
    modules.sort(key=lambda item: item[:3])
    return [module for *_, module in modules[:MAX_MODULES]]


# --- documentation


def documents(tree: Tree) -> list[dict[str, Any]]:
    """The README, the usual top-level documents, and what is under docs."""

    def is_document(path: str) -> bool:
        return path.lower().endswith((".md", ".mdx", ".markdown", ".rst", ".txt"))

    def named(path: str, *stems: str) -> bool:
        return is_document(path) and basename(path).upper().startswith(stems)

    top = [path for path in tree.sizes if "/" not in path]
    chosen = [path for path in top if named(path, "README")]
    chosen += [
        path
        for path in top
        if named(path, "CONTRIBUTING", "CHANGELOG", "SECURITY", "ARCHITECTURE")
    ]
    chosen += [
        path
        for path in tree.sizes
        if path.split("/")[0] in ("docs", "doc")
        and "/" in path
        and is_document(path)
        and not path.lower().endswith(".txt")
    ]
    chosen += [
        path
        for path in tree.sizes
        if 1 <= path.count("/") <= 3
        and named(path, "README")
        and not any(part.startswith(".") for part in path.split("/"))
    ]
    unique = list(dict.fromkeys(chosen))[:MAX_DOCUMENTS]
    return [
        {"path": path, "title": title_of(tree.read(path, HEAD_BYTES) or "", path)}
        for path in unique
    ]


def title_of(text: str, path: str) -> str:
    """A document's own title: its front matter's, its first heading, or,
    failing both, its file name."""
    lines = text.splitlines()[:200]
    if lines and lines[0].strip() == "---":
        for line in lines[1:]:
            if line.strip() == "---":
                break
            if line.lower().startswith("title:"):
                title = clean(line.partition(":")[2].strip().strip("\"'"))
                if title:
                    return title
    for index, line in enumerate(lines):
        stripped = line.strip()
        title = ""
        if stripped.startswith("# "):
            title = stripped[2:].strip().rstrip("#")
        elif match := HTML_TITLE.search(stripped):
            title = TAG.sub("", match.group(1))
        elif (
            path.lower().endswith(".rst")
            and stripped
            and index + 1 < len(lines)
            and len(lines[index + 1].strip()) >= 3
            and set(lines[index + 1].strip()) <= set("=-~#*")
            and len(set(lines[index + 1].strip())) == 1
        ):
            title = stripped
        title = MARKDOWN_LINK.sub(r"\1", title).replace("`", "")
        title = clean(EMPHASIS.sub(lambda found: found[2] or found[4], title))
        if title:
            return title
    return clean(basename(path))


# --- the summary


def summarise(
    tree: Tree,
    code: dict[str, str],
    languages: list[dict[str, Any]],
    reading: Reading,
) -> str:
    """A few sentences, each one a count or a declaration read from the tree."""
    size = sum(tree.sizes[path] for path in code)
    kinds = len({language for language in code.values()})
    sentences: list[str] = []
    files = plural(len(tree.sizes), "file")
    if languages:
        top = languages[0]
        sentences.append(
            f"{files} at this commit, with {amount(size)} of code in "
            f"{plural(kinds, 'language')}, mostly {top['name']} "
            f"({percent(top['share'])})."
        )
    else:
        sentences.append(
            f"{files} at this commit, none in a programming language "
            "this inspection recognises."
        )
    if tree.truncated:
        sentences.append(
            f"Only the first {len(tree.sizes):,} files were read; the rest "
            "are not counted here."
        )
    if reading.frameworks:
        shown = reading.frameworks[:6]
        more = len(reading.frameworks) - len(shown)
        names = series([*shown, f"{more} more"] if more else shown)
        sentences.append(f"It uses {names}.")
    declared = len(reading.dependencies)
    if declared:
        listed = (
            f" The first {MAX_DEPENDENCIES} are listed."
            if declared > MAX_DEPENDENCIES
            else ""
        )
        sentences.append(
            f"Its manifests declare {plural(declared, 'dependency', 'dependencies')}, "
            "listed here as declared and not checked against security "
            f"advisories.{listed}"
        )
    elif reading.manifests:
        sentences.append("Its manifests declare no dependencies.")
    else:
        sentences.append("No dependency manifest was found.")
    if not reading.tests:
        sentences.append("No test command was found.")
    sentences.append(
        "This was read from the files alone: nothing in the repository was run."
    )
    return " ".join(sentences)
