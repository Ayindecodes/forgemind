<img src="docs/brand/forgemind-logo.svg" alt="ForgeMind" height="36">

Autonomous software engineering and repository intelligence platform.

## Layout

- `apps/web`: the Next.js frontend.
- `apps/api`: the API, its workers and its sweeper, in Python on PostgreSQL and Redis.
- `apps/dev-api`: a development API that plays the contract with made-up data, for local work on the interface. It is never deployed.
- `packages/contract`: the Zod schemas shared by the frontend and the API.
- `packages/conformance`: holds a running service to the contract.
- `deploy/staging`: what a staging deployment runs.

## Getting started

Requires Node 24 and Corepack (`corepack enable`).

```sh
pnpm install
pnpm dev
```

The web app runs on http://localhost:3200 and the dev API on http://localhost:4000. Browser tests start their own servers on ports 3110 and 4110.

## Quality

[docs/quality-review.md](docs/quality-review.md) records the result of every item on the design brief's quality bar, with the test that proves it.

[docs/backend-plan.md](docs/backend-plan.md) is the plan for the next phase: the real API, workers and sandboxes behind the same contract.

## Staging

`scripts/staging.sh` runs the interface, the API, a worker and the sweeper with their PostgreSQL and Redis on one machine, built from the commit that is checked out and reached through one port on the loopback address. [docs/staging.md](docs/staging.md) says how it is deployed, what it keeps secret and what it does not do yet.

## Commands

| Command            | What it does                                               |
| ------------------ | ---------------------------------------------------------- |
| `pnpm build`       | Builds the web app                                         |
| `pnpm typecheck`   | Type-checks every package                                  |
| `pnpm lint`        | Runs ESLint                                                |
| `pnpm test`        | Runs the unit tests                                        |
| `pnpm test:e2e`    | Runs the Playwright browser tests                          |
| `pnpm test:visual` | Compares every route with recorded pictures in both themes |
| `pnpm format`      | Formats the repository                                     |

The browser tests need Chromium: `pnpm --filter @forgemind/web exec playwright install chromium`.

The API in `apps/api` is Python, managed by [uv](https://docs.astral.sh/uv/): `uv sync --project apps/api`, then `uv run --project apps/api pytest`. `docker compose up` starts it, a worker and the sweeper with PostgreSQL and Redis on localhost-only ports 4200, 5440 and 6390. See `apps/api/README.md`.

`scripts/conformance.sh` runs `packages/conformance`, which calls a live service and checks every response against the contract: the dev API proves the harness, and the API image shows what it implements and lists the rest. It also adds up the events the service serves and holds the usage the service reports to the sum. `scripts/worker-check.sh` runs the image as the API, a worker and the sweeper in separate containers, and checks that a task is executed, that a connected repository is cloned and indexed, that a run or an indexing whose queue message was lost is queued again, that the worker's log of a run names the request and the trace that asked for it, and that the usage reported is what the events add up to. `scripts/web-against-api.sh <playwright args>` runs the interface's browser tests against the real API image instead of the dev API. `scripts/staging-check.sh` deploys the checkout the way staging is deployed, behind a proxy that ends TLS, and has a person sign in, connect a repository and inspect it in a browser. `scripts/gate.sh` runs every check above except `web-against-api.sh`, in order, and stops at the first failure; `scripts/gate.sh --fresh` does it on a clean clone of HEAD. The same script runs on GitHub Actions for every push and pull request.
