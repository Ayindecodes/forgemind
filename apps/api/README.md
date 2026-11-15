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
uv run python -m forgemind_api migrate   # bring FORGEMIND_DATABASE_URL to the current schema, or to the revision named after it
uv run python -m forgemind_api seed      # development and test only: a known organization and fixed tokens
uv run python -m forgemind_api worker    # execute the runs and index the repositories on the queue at FORGEMIND_REDIS_URL
uv run python -m forgemind_api sweeper   # queue again what lost its worker or its message
uv run python -m forgemind_api usage-check   # compare the usage ledger with the events it was written from
uv run python -m forgemind_api check worker  # read the settings as `worker` would, and do nothing more
```

The worker and the seed clone repositories, so they need `git` and
coreutils' `timeout` on the PATH. The image has both.

Sign-in goes through GitHub. `FORGEMIND_GITHUB_PROVIDER=simulated`, the default
outside production, serves GitHub look-alike pages instead, so the interface and
the tests can sign in without credentials; `github` needs the App's
credentials, listed under Settings below.

The schema lives in `src/forgemind_api/models` and its migrations in
`src/forgemind_api/migrations`, generated with Alembic and reviewed. The
database tests start a throwaway PostgreSQL in Docker through testcontainers.

## Settings

Every setting is a `FORGEMIND_` variable, read once when a process starts
(`src/forgemind_api/settings.py`). A process that cannot use what it was
given says so in one line, naming every variable at fault and none of the
values, and exits 2. `check <command>` does that reading and nothing else, so
a deployment can ask before it replaces what is running.

- **Secrets as files.** `FORGEMIND_<NAME>_FILE` names a file that holds the
  value of `FORGEMIND_<NAME>`, less its line ending. Setting both, or naming
  a file that is missing, unreadable or empty, is refused.
- **The database's password** can be kept out of the URL:
  `FORGEMIND_DATABASE_PASSWORD`, or its `_FILE`, is put into a
  `FORGEMIND_DATABASE_URL` written without one. Whatever the password holds
  is escaped. A URL that already carries a password is refused beside it.
- **GitHub's credentials, by process.** With the `github` provider the API
  needs `FORGEMIND_GITHUB_CLIENT_ID`, `_CLIENT_SECRET`, `_APP_ID`,
  `_APP_PRIVATE_KEY` and `_WEBHOOK_SECRET`; a worker needs the App's id and
  its private key, for the token it clones with; the sweeper and the other
  commands need none, and are not refused for lacking them.
- **Served under a path.** `FORGEMIND_API_ORIGIN` is where browsers reach
  the API. When a proxy serves it under a path and takes the path off, as in
  `https://staging.example.com/api`, the origin says so: the links the API
  writes, its OpenAPI document and the simulated GitHub's pages then point
  through the proxy, and the log names a path as the browser asked for it.
- **Times are UTC.** Every connection reads times in UTC, whatever zone the
  database or its server is set to.

`tests/test_settings_files.py`, `tests/test_settings_database.py`,
`tests/test_settings_github.py` and `tests/test_commands.py` cover the
reading, `tests/test_served_under_a_path.py` the path and
`tests/test_time_zone.py` the zone.

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

## Usage

Usage is what the events say was used. Recording an event also enters what
it measures in a ledger, in the same transaction: the tokens a model call
read and wrote, the sandbox time, processor time and memory between two
resource samples, and the time a retried attempt took
(`src/forgemind_api/metering.py`, the same arithmetic as
`packages/contract/src/metering.ts`). `GET /usage` adds the ledger up for
the caller's organization over the calendar month so far, in UTC, and counts
the runs that started in it by how they ended.

Cost is an estimate or it is unavailable. It is never reported as actual:
the service reads no bill. `FORGEMIND_PRICES` sets what usage is taken to
cost, in US dollars per million tokens and per sandbox hour. No rate is built
in. The names and numbers below are made up to show the shape:

```
FORGEMIND_PRICES='{"tokens": {"example/model-a": {"input": 1.5, "output": 6}}, "sandbox_hour": 0.25}'
```

When something used in the period has no price, the cost is `unavailable`
and the reason names what is missing; a partial sum is not shown as the
cost. Quotas report what was used with no maximum: nothing on this server
limits an organization yet, only a task's own budget.

`usage-check` measures every run's events again and compares the result
with the ledger, entry by entry, and with the start and outcome each run is
counted by. It prints one line of JSON and exits 1 if they disagree:

```
{"runs": 2, "events": 4, "records": 0, "agrees": true, "differences": []}
```

No stage has an executor yet, so a run on this server calls no model and
starts no sandbox: its events measure nothing, the ledger stays empty and
the figures are run counts beside zeros. `tests/test_usage.py` covers the
sums with recorded model calls and samples, `tests/test_metering.py` holds
the arithmetic to what the contract's comes to for every scenario the dev
API plays, and the conformance harness adds up the events a service serves
and holds `GET /usage` to them.

## Observability

Every request and every job is traced, timed and logged, by the API, the
workers and the sweeper alike (`src/forgemind_api/telemetry.py`). A job is a
delivery a worker handles, `forgemind.execute_run` or
`forgemind.index_repository`, or a sweep, `forgemind.sweep_runs` or
`forgemind.sweep_indexing`.

- **Traces.** One span for each request and each job. A message on the
  queue carries the trace it was sent in, so the delivery of a run belongs
  to the trace of the request that created its task, or of the sweep that
  queued it again. An incoming `traceparent` header is continued.
- **Metrics.** `http.server.duration` by route and status for requests;
  `forgemind.jobs` and `forgemind.job.duration` by job and by what the job
  came to.
- **Logs.** One JSON object to a line on stdout. Every line carries
  `request_id`, and `trace_id` and `span_id` when written inside a request
  or a job; the line that ends a request or a job carries `duration_ms`. The
  request id comes from the `x-request-id` header or is made up, is returned
  in the response, and travels with the queue message, so a worker's lines
  about a run name the request that asked for it. A sweep that found nothing
  to do is logged at `DEBUG`. A request's line holds its path and not its
  query, and the server under the app writes no line of its own.

Traces and metrics are recorded always and sent only when
`FORGEMIND_OTEL_ENDPOINT` names an OTLP/HTTP collector, such as
`http://collector:4318`. The three processes report as `forgemind-api`,
`forgemind-worker` and `forgemind-sweeper`. `OTEL_TRACES_SAMPLER` and
`OTEL_TRACES_SAMPLER_ARG` choose what is sampled, as the OpenTelemetry SDK
reads them. A worker sends what it recorded after each delivery, since it
may be killed at any time, and waits at most five seconds for the collector
to take its traces and five for its metrics: a collector that is down slows
jobs by that much and fails none.

`tests/test_telemetry.py` covers what is recorded, and
`tests/test_worker_recovery.py` what real worker and sweeper processes send
to a collector standing in for a real one. No collector ships with the
Compose file.

## Compose

From the repository root, `docker compose up` builds the service and starts
the API, a worker and the sweeper with PostgreSQL and Redis on localhost-only
ports.
