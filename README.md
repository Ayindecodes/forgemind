<img src="docs/brand/forgemind-logo.svg" alt="ForgeMind" height="36">

Autonomous software engineering and repository intelligence platform.

## Layout

- `apps/web`: the Next.js frontend.
- `apps/dev-api`: a development API that implements the contract until the real backend exists. It is never deployed.
- `packages/contract`: the Zod schemas shared by the frontend and the API.

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

`scripts/conformance.sh` runs `packages/conformance`, which calls a live service and checks every response against the contract: the dev API proves the harness, and the API image shows what it implements and lists the rest. `scripts/worker-check.sh` runs the image as the API, a worker and the sweeper in separate containers, and checks that a task is executed and that a run whose queue message was lost is queued again. `scripts/web-against-api.sh <playwright args>` runs the interface's browser tests against the real API image instead of the dev API. `scripts/gate.sh` runs every check above in order and stops at the first failure; `scripts/gate.sh --fresh` does it on a clean clone of HEAD. The same script runs on GitHub Actions for every push and pull request.
