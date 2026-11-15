"""`python -m forgemind_api serve` serves the API; `migrate` brings the database
to the current schema; `worker` executes runs from the queue; `sweeper` looks
after runs that lost their worker; `usage-check` compares the usage ledger
with the events it was written from; `check <command>` reads the settings as
that command would and does nothing more. All read their settings from the
environment."""

from __future__ import annotations

import sys

import uvicorn

from forgemind_api.db import make_engine, migrate
from forgemind_api.seed import seed
from forgemind_api.settings import Process, SettingsError, load_settings
from forgemind_api.usage import check_usage
from forgemind_api.worker import run_sweeper, run_worker

# What each command is, for the credentials it must be given. Every other
# command is given none.
PROCESSES: dict[str, Process] = {"serve": "api", "worker": "worker"}


def main(argv: list[str]) -> int:
    command = argv[0] if argv else "serve"
    # A deployment asks this before it replaces what is running.
    only_check = command == "check"
    if only_check:
        command = argv[1] if len(argv) > 1 else "serve"
    settings = load_settings(process=PROCESSES.get(command, "other"))
    if only_check:
        return 0
    if command == "migrate":
        if settings.database_url is None:
            raise SettingsError("FORGEMIND_DATABASE_URL is required to migrate")
        migrate(settings.database_url)
        return 0
    if command == "seed":
        if settings.database_url is None:
            raise SettingsError("FORGEMIND_DATABASE_URL is required to seed")
        seed(make_engine(settings.database_url), settings)
        return 0
    if command == "serve":
        uvicorn.run(
            "forgemind_api.app:app",
            host="0.0.0.0",  # the container is the boundary
            port=settings.port,
            log_config=None,
            access_log=False,  # the app logs each request itself, with its id
        )
        return 0
    if command == "worker":
        return run_worker(settings)
    if command == "sweeper":
        return run_sweeper(settings)
    if command == "usage-check":
        if settings.database_url is None:
            raise SettingsError("FORGEMIND_DATABASE_URL is required to check usage")
        engine = make_engine(settings.database_url)
        try:
            return check_usage(engine)
        finally:
            engine.dispose()
    sys.stderr.write(
        f"unknown command {command!r}; use serve, migrate, seed, worker, sweeper, "
        "usage-check or check\n"
    )
    return 2


def run(argv: list[str]) -> int:
    """`main`, with settings it cannot use said in a line and not as a
    traceback: the line names every variable at fault and none of the values."""
    try:
        return main(argv)
    except SettingsError as error:
        sys.stderr.write(f"{error}\n")
        return 2


if __name__ == "__main__":
    sys.exit(run(sys.argv[1:]))
