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
uv run python -m forgemind_api worker    # execute the runs and index the repositories on the queue at FORGEMIND_REDIS_URL
uv run python -m forgemind_api sweeper   # queue again what lost its worker or its message
```

The worker and the seed clone repositories, so they need `git` and
coreutils' `timeout` on the PATH. The image has both.

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
containers, executing a task and indexing a repository.

## Repository inspection

Connecting a repository leaves it `analyzing` and asks for a worker, the same
way a run does: a message on Redis, a claim in the database, a heartbeat, and
the sweeper for whatever gets lost. The worker clones the repository at the
commit its default branch is at, reads it, and stores what it found against
that commit. `GET /repositories/:id/analysis` serves it, and the repository
becomes `connected`. A repository that cannot be indexed becomes `error` with
the reason; a failure that may pass is tried again, at most
`FORGEMIND_WORKER_MAX_ATTEMPTS` times. Tasks are accepted for indexed
repositories only.

The repository is not trusted and neither is the machine's git setup
(`src/forgemind_api/workspace.py`). Git runs with an environment built for
the one clone: no system or user configuration, no hooks, no credential
helpers, no redirects, no submodules, and only the protocol the source uses.
With the `github` provider the clone is authorised by an installation token
for that one repository with read access to its contents, sent to that one
address, kept off command lines and out of files, and revoked afterwards.
The checkout must finish within `FORGEMIND_INDEXING_SECONDS` (300) and fit in
`FORGEMIND_WORKSPACE_MEGABYTES` (512). The tree has no `.git` and no links,
is read-only, sits under `FORGEMIND_WORKSPACE_ROOT` (the system's temporary
directory by default) and is removed when the inspection is over; what a
killed worker left there is removed by the next one.

The inspection (`src/forgemind_api/inspection.py`) only reads files: nothing
in the repository is run, imported or installed. It reports languages by
their share of the code, frameworks, entry points, the directories the
repository is made of, dependencies as its manifests declare them, the test
and build commands it declares, its documentation, and concerns such as
missing tests or lock files, each pointing at a file. Nothing under a test,
example, fixture or benchmark directory counts as an entry point, and an
example's manifest is not read as the repository's own, unless examples are
all the repository holds. It says what it read. It does not say that a
command passes, or that a dependency is safe: no security advisories are
consulted yet.

The simulated provider's repositories are real git repositories, committed
from `src/forgemind_api/simulated_repositories.py` when they are cloned, so
the seed's analyses come from the same code as a worker's.
`FORGEMIND_LOCAL_REPOSITORIES=/srv/repositories` makes the simulated provider
also offer the bare repositories at `/srv/repositories/<owner>/<name>.git`,
which is how a real repository is indexed before a GitHub App is registered:

```
git clone --mirror https://github.com/<owner>/<name>.git /srv/repositories/<owner>/<name>.git
```

`tests/test_workspace.py` and `tests/test_github_clone.py` cover the checkout
against real git, the latter over git's own HTTP server.
`tests/test_inspection.py` covers what is read, `tests/test_indexing.py` the
claim and its outcomes, and `tests/test_indexing_recovery.py` real workers
killed while indexing.

## Compose

From the repository root, `docker compose up` builds the service and starts
the API, a worker and the sweeper with PostgreSQL and Redis on localhost-only
ports.
