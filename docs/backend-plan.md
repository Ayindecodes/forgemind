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

## Later phases, at milestone level

- **Phase 2 Repository intelligence.** Dependency analysis, source
  indexing, repository summaries, static analysis and basic security
  scanning. Milestone: an evidence-backed technical report for a real
  repository, with every finding pointing at a commit and a line.
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
