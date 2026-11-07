"""`python -m forgemind_api` serves the API with the settings from the environment."""

from __future__ import annotations

import uvicorn

from forgemind_api.settings import load_settings


def main() -> None:
    settings = load_settings()
    uvicorn.run(
        "forgemind_api.app:app",
        host="0.0.0.0",  # the container is the boundary
        port=settings.port,
        log_config=None,
        access_log=False,  # the app logs each request itself, with its id
    )


if __name__ == "__main__":
    main()
