# Backend plan

The frontend is complete and runs on a dev API that serves the contract in
`packages/contract` from an in-memory store. This plan replaces that dev API
with the real system, phase by phase, behind the same contract. Each task
ends with a check that runs in the gate; a task is done when that check
passes from a clean clone, not when the code exists.

Rules carried over from the brief and already encoded in the contract:

- A run is verified only when every required check ran and passed.
- Nothing merges or deploys on its own; delivery is a pull request after a
  person approves.
- The interface shows real execution events only. Agent explanations are
  labelled apart from execution.
- Repository code, install scripts, builds and tests are untrusted. No host
  secrets reach them, and there is no unrestricted Docker socket.
- Retries are bounded. Tasks have budgets.
- Permissions are enforced by the backend, per organization, independently
  of the interface.

## Stack

Python 3.13 with FastAPI and Pydantic v2, SQLAlchemy 2 with Alembic
migrations on PostgreSQL 17, Celery on Redis 7 for background work, Docker
for isolated execution, OpenTelemetry with structured logs. Tooling: uv,
ruff, pyright, pytest. The service lives in `apps/api`; workers share its
code and run as a separate process.

The TypeScript contract stays the source of truth. A conformance harness
(BE-03) validates every backend response against the Zod schemas, so the
frontend's browser suites can later run unchanged against the backend.

## Phase 1: Foundation

Milestone: a person signs in with GitHub, connects a repository, and
inspects its basic structure, on a staging URL.

- **BE-01 Service scaffold.** `apps/api` with settings, health, structured
  logging, OpenTelemetry hooks, ruff, pyright and pytest; Docker Compose
  for PostgreSQL and Redis; the gate and CI run its checks. _Done when:_
  `GET /health` answers from a container and the gate passes with the new
  steps.
- **BE-02 Schema and migrations.** The entities in the brief's database
  design: users, organizations, members, repository connections, tasks,
  runs, execution events, artifacts, verification results, pull requests,
  findings, usage, audit, and credential references. _Done when:_
  migrations apply to an empty database and roll back, with model tests.
- **BE-03 Contract conformance harness.** A runner that calls a live API
  and validates every response with the contract's schemas and endpoint
  registry, listing unimplemented endpoints explicitly. _Done when:_ it
  runs in CI against the seeded service and passes for every endpoint
  implemented so far.
- **BE-04 Sessions and GitHub sign-in.** GitHub App user authorization,
  server-side sessions in an httpOnly SameSite cookie, expiry, sign-out,
  and the `signed_out` / `expired` reasons the interface expects. _Done
  when:_ the frontend's auth suite passes against the backend.
- **BE-05 Organizations, members, roles, audit.** Invitation, role change
  and removal with the rules the dev API enforces today, audit entries for
  every consequential action, and cross-tenant isolation. _Done when:_ the
  settings suite passes and tenant isolation tests prove a member of one
  organization cannot read or change another's data.
- **BE-06 GitHub App installation and repositories.** Installation flow,
  webhook receiver for installation events, the repository list with the
  permission table from the App manifest, connect, disconnect and revoke.
  _Done when:_ the repositories suite passes against a real installation on
  a test organization.
- **BE-07 Tasks and events.** Create, list, get and cancel with budgets;
  the execution event table as the single record of what happened; the
  event stream with resume by last event id; the run queries. _Done when:_
  the live-layer suite passes against the backend streaming database-backed
  events.
- **BE-08 Workers.** Celery on Redis with idempotent task execution,
  heartbeats, bounded retries, and recovery when a worker dies mid-run.
  _Done when:_ a worker killed mid-run leaves a run that either resumes or
  fails with its events intact, under test.
- **BE-09 Basic repository inspection.** Clone at the base commit into an
  isolated read-only workspace; detect languages, frameworks, entry points
  and the test and build commands; serve the analysis the repository page
  renders. _Done when:_ the repository page shows a real analysis of a real
  repository.
- **BE-10 Usage accounting and observability.** Usage derived from recorded
  events, with the estimate and unavailable states the interface labels;
  traces, metrics and logs for every request and job. _Done when:_ the
  usage page shows real numbers that reconcile with the event table.
- **BE-11 Staging deployment.** Dockerfiles, Compose for staging, migrations
  on deploy, secret management, HTTPS on a public domain, the frontend
  pointed at the API, and the dev API kept only for local work. _Done
  when:_ MVP steps 1 and 2 and the basic inspection work on the staging
  URL.

## Phase 2: Repository intelligence

Milestone: an evidence-backed technical report for a real repository, with
every finding pointing at a commit and a line.

Four things hold for every task in it:

- Everything is found by reading files. Nothing in a repository is run,
  imported or installed, and no tool is used that loads a repository's own
  configuration or plugins. Running anything waits for Phase 4.
- A finding claims what was read and no more. Where what was matched is
  itself the weakness, the finding is confirmed; where it is only a place
  one could be, it is a suspicion and says so.
- A credential found in a repository is copied nowhere: not into the
  database, a log or a response. The finding says where it is and of what
  kind.
- Nothing about a repository leaves the machine to learn what is in it.
  Advisories are downloaded and matched here.

The tasks:

- **BE-12 Findings, each at a commit.** A scan after the inspection, in the
  same isolated checkout. What it raises is stored with the commit and the
  line, and brought up to date each time the repository is indexed: found
  again, it stays the one finding; no longer found, it is closed at the
  commit that no longer has it; dismissed, it stays dismissed. A repository
  is indexed again when its default branch moves. `GET /findings` per
  organization, and a repository's open count from the same table. The
  first scanner: committed credentials, which are private keys and tokens
  in a format their issuer documents. _Done when:_ a private key committed
  to a repository shows on the Security page at its commit and line, the
  key itself stored nowhere, and the commit that removes it closes the
  finding.
- **BE-13 Dependencies as locked.** Lockfiles read for the versions they
  pin, each with the file and line that pins it and whether a manifest asks
  for it by name. The analysis lists what is locked, says so where only a
  range is declared, and names the lockfiles it cannot read. _Done when:_
  the dependencies shown for a real repository are the versions its
  lockfiles pin, each opening at its line.
- **BE-14 Known advisories.** OSV's public export kept on the machine,
  refreshed on a schedule and dated; about 300 MB zipped for npm, PyPI, Go,
  crates.io, RubyGems, Packagist and Maven on 2026-11-15. Locked versions
  are matched against it here, by each ecosystem's own ordering of
  versions. A match is flagged in the analysis and raised as a finding at
  the line that pins it, with the advisory's id, its link and the severity
  the advisory gives. A dependency with no locked version is a suspicion at
  most, and an ecosystem that is not matched is said to be unchecked.
  _Done when:_ a repository locking a version an advisory names shows it as
  vulnerable with the advisory linked, the same repository on the fixed
  version does not, and indexing either sends no package name off the
  machine.
- **BE-15 Source index.** Python, JavaScript and TypeScript parsed, not
  run: for each file its lines, what it declares and where, and what it
  imports. Kept per commit, so that a declaration can be found by name.
  Modules are ranked by what imports them, and the summary says what was
  measured. A file that cannot be parsed is named, not passed over. _Done
  when:_ the modules and the summary of a real repository come from its
  parsed source, and a declaration is found by name at the indexed commit.
- **BE-16 Static analysis.** Rules over the parsed source: a command run
  through a shell, text evaluated as code, unsafe deserialization, a
  certificate check turned off, HTML set from a value, a query assembled
  from text. Each rule is written down with what it claims and whether a
  match is the weakness or a lead, and raises its finding with the rule,
  the commit and the line. _Done when:_ every rule raises its finding on
  code that has the weakness and none on the nearest safe form, and the
  findings of a real repository open at the right lines.
- **BE-17 The technical report.** The repository page as one report:
  summary, structure, dependencies, findings and concerns, each statement
  with the file and line it rests on, and what was not looked at said as
  plainly as what was. The same report as a document to download, naming
  the commit, the time, the scanners and the date of the advisories. _Done
  when:_ on staging, the report of a real repository is read and
  downloaded, and every finding in it opens at its commit and line.

## Later phases, at milestone level

- **Phase 3 Agent orchestration.** The task state machine persisted in
  PostgreSQL, the Architect, Developer, Testing and Review agents behind a
  provider-independent LLM layer, and event streaming from the workers.
  Milestone: a bounded task investigated and a change proposed, with
  progress reported as it happens. Nothing executes repository code before
  Phase 4 exists.
- **Phase 4 Sandbox and verification.** Isolated execution with resource
  limits and restricted network, real test and build runs, execution logs,
  patch generation, bounded revision loops. Milestone: a change made and
  verified with actual tools.
- **Phase 5 GitHub delivery.** Branches, pull request creation after
  approval, status synchronization, execution history. Milestone: a
  reviewable pull request with verification evidence.
- **Phase 6 Advanced intelligence.** Incremental indexing, dependency
  graphs, deeper security analysis, multi-repository management, policies,
  metering and analytics.

## Decisions needed before BE-01 starts

- Where the services run during development. PostgreSQL and Redis can run
  in Docker Compose on any machine; Phase 4's sandboxes need a machine of
  their own, not a shared server.
- A GitHub test organization and a GitHub App registered for staging, for
  BE-04 and BE-06.
- Which LLM providers to support first, for Phase 3.
