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
uv run python -m forgemind_api seed      # development and test only: a known organization and fixed tokens
uv run python -m forgemind_api worker    # execute the runs on the queue at FORGEMIND_REDIS_URL
uv run python -m forgemind_api sweeper   # queue again the runs that lost their worker or their message
```

Sign-in goes through GitHub. `FORGEMIND_GITHUB_PROVIDER=simulated`, the default
outside production, serves GitHub look-alike pages instead, so the interface and
the tests can sign in without credentials; `github` needs
`FORGEMIND_GITHUB_CLIENT_ID` and `FORGEMIND_GITHUB_CLIENT_SECRET`.

The schema lives in `src/forgemind_api/models` and its migrations in
`src/forgemind_api/migrations`, generated with Alembic and reviewed. The
database tests start a throwaway PostgreSQL in Docker through testcontainers.

## Workers

Creating a task records a run and puts a message on Redis. The message only
says that the run wants a worker; the database decides who gets it. A worker
claims the run under a row lock, proves on a timer that it still holds it,
and records everything it does as events. Every write checks the claim
again, so a worker that lost its run cannot add to the record.

A worker that dies stops proving itself. The sweeper, a process of its own,
notices after `FORGEMIND_WORKER_STALE_SECONDS` and queues the run again. The
next worker closes what the lost one left in progress and continues from the
record: stages that finished are not run again. A run is picked up at most
`FORGEMIND_WORKER_MAX_ATTEMPTS` times and never past its task's time budget;
after either it is ended with the reason, its events intact. The sweeper also
queues runs whose message never arrived, so the API creates tasks even while
Redis is down.

No stage has an executor yet, so a run is started and then ended with a
message saying the inspection stage is not available on this server.

`tests/test_worker.py` covers this in one process, and
`tests/test_worker_recovery.py` with real worker processes on a real Redis,
killed with SIGKILL mid-run. `scripts/worker-check.sh` at the repository root
does the image's part: the API, a worker and the sweeper as separate
containers.

## Compose

From the repository root, `docker compose up` builds the service and starts
the API, a worker and the sweeper with PostgreSQL and Redis on localhost-only
ports.
