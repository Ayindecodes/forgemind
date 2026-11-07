# ForgeMind API

The service behind the interface. It serves the contract in
`packages/contract` from PostgreSQL, with workers on Redis for anything that
outlives a request. See `docs/backend-plan.md` at the repository root for
what it covers, task by task.

```
uv sync                 # dependencies and a .venv, Python 3.13 fetched if missing
uv run pytest           # unit tests
uv run ruff check .     # lint
uv run pyright          # types
uv run python -m forgemind_api serve     # serve on FORGEMIND_PORT, 4200 by default
uv run python -m forgemind_api migrate   # bring FORGEMIND_DATABASE_URL to the current schema
```

The schema lives in `src/forgemind_api/models` and its migrations in
`src/forgemind_api/migrations`, generated with Alembic and reviewed. The
database tests start a throwaway PostgreSQL in Docker through testcontainers.

From the repository root, `docker compose up` builds the service and starts
it with PostgreSQL and Redis on localhost-only ports.
