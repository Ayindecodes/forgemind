"""`python -m forgemind_api serve` serves the API; `migrate` brings the database
to the current schema; `worker` executes runs from the queue; `sweeper` looks
after runs that lost their worker. All read their settings from the
environment."""

from __future__ import annotations

import sys

import uvicorn

from forgemind_api.db import make_engine, migrate
from forgemind_api.seed import seed
from forgemind_api.settings import SettingsError, load_settings
from forgemind_api.worker import run_sweeper, run_worker


def main(argv: list[str]) -> int:
    command = argv[0] if argv else "serve"
    settings = load_settings()
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
    sys.stderr.write(
        f"unknown command {command!r}; use serve, migrate, seed, worker or sweeper\n"
    )
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
