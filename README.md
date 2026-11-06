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

## Commands

| Command          | What it does                      |
| ---------------- | --------------------------------- |
| `pnpm build`     | Builds the web app                |
| `pnpm typecheck` | Type-checks every package         |
| `pnpm lint`      | Runs ESLint                       |
| `pnpm test`      | Runs the unit tests               |
| `pnpm test:e2e`  | Runs the Playwright browser tests |
| `pnpm format`    | Formats the repository            |

The browser tests need Chromium: `pnpm --filter @forgemind/web exec playwright install chromium`.
