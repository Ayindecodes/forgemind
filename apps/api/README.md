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
uv run python -m forgemind_api   # serve on FORGEMIND_PORT, 4200 by default
```

From the repository root, `docker compose up` builds the service and starts
it with PostgreSQL and Redis on localhost-only ports.
