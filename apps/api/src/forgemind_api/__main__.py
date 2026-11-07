"""`python -m forgemind_api serve` serves the API; `migrate` brings the database
to the current schema. Both read their settings from the environment."""

from __future__ import annotations

import sys

import uvicorn

from forgemind_api.db import migrate
from forgemind_api.settings import SettingsError, load_settings


def main(argv: list[str]) -> int:
    command = argv[0] if argv else "serve"
    settings = load_settings()
    if command == "migrate":
        if settings.database_url is None:
            raise SettingsError("FORGEMIND_DATABASE_URL is required to migrate")
        migrate(settings.database_url)
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
    sys.stderr.write(f"unknown command {command!r}; use serve or migrate\n")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
