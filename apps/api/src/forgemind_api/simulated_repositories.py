"""The source behind the simulated GitHub's repositories.

Every tree here is made up: small projects written for development and for
the tests, so that the simulated GitHub has something to hand over. What is
done with them is real. Each is committed with git, cloned the way any
repository is, and inspected from its files, so what the interface shows for
one of them is what the inspection found, not something written to be shown.

A tree is committed the same way every time, by one author at one moment, so
a repository has the same commit wherever it is made."""

from __future__ import annotations

import subprocess
from pathlib import Path

# Who commits a simulated repository, and when. Fixed, so the commit is too.
IDENTITY = {
    "GIT_AUTHOR_NAME": "Simulated GitHub",
    "GIT_AUTHOR_EMAIL": "simulated@forgemind.invalid",
    "GIT_AUTHOR_DATE": "2026-10-01T09:00:00+00:00",
    "GIT_COMMITTER_NAME": "Simulated GitHub",
    "GIT_COMMITTER_EMAIL": "simulated@forgemind.invalid",
    "GIT_COMMITTER_DATE": "2026-10-01T09:00:00+00:00",
}

PNPM_LOCK = """\
lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false
"""

CI = """\
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make test
"""

TSCONFIG = """\
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
"""

FORGEMIND_API = {
    "README.md": """\
# ForgeMind API

The HTTP service behind the task board: it stores tasks and their runs and
hands work to the workers.

## Running it

    pnpm install
    pnpm dev

The service reads `DATABASE_URL` and listens on `PORT` (4000 by default).
""",
    "docs/architecture.md": """\
# Architecture

Requests enter through `src/app.ts`, which mounts one router per resource.
Routers validate their input with zod and talk to PostgreSQL through
Drizzle. Nothing here runs a task: a run is a row that a worker claims.

## Retries

A run may be retried until its budget is spent. `src/lib/budget.ts` decides
whether another attempt is allowed, and `src/lib/retry.ts` spaces them out.
""",
    "package.json": """\
{
  "name": "@forgemind/api",
  "version": "0.4.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "test": "vitest run",
    "migrate": "./scripts/migrate.sh"
  },
  "dependencies": {
    "@hono/node-server": "^1.13.0",
    "drizzle-orm": "^0.36.0",
    "hono": "^4.6.0",
    "pg": "^8.13.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/pg": "^8.11.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
""",
    "pnpm-lock.yaml": PNPM_LOCK,
    "tsconfig.json": TSCONFIG,
    ".github/workflows/ci.yml": CI.replace("make test", "pnpm install && pnpm test"),
    "migrations/0001_tasks.sql": """\
CREATE TABLE tasks (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  request text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  max_minutes integer NOT NULL DEFAULT 60,
  max_retries integer NOT NULL DEFAULT 2,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tasks_status_created_at ON tasks (status, created_at DESC);
""",
    "migrations/0002_runs.sql": """\
CREATE TABLE runs (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  attempt integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'queued',
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX runs_task_id ON runs (task_id);
""",
    "scripts/migrate.sh": """\
#!/usr/bin/env sh
# Applies every migration that has not been applied yet, in name order.
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \\
  'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY)'

for file in migrations/*.sql; do
  name=$(basename "$file")
  applied=$(psql "$DATABASE_URL" -tA -c \\
    "SELECT 1 FROM schema_migrations WHERE name = '$name'")
  if [ -z "$applied" ]; then
    echo "applying $name"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$file"
    psql "$DATABASE_URL" -c \\
      "INSERT INTO schema_migrations (name) VALUES ('$name')"
  fi
done
""",
    "src/server.ts": """\
import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { connect } from './db/client.js';

const port = Number(process.env.PORT ?? 4000);
const database = connect(process.env.DATABASE_URL ?? '');

serve({ fetch: createApp(database).fetch, port }, () => {
  console.log(`api listening on ${port}`);
});
""",
    "src/app.ts": """\
import { Hono } from 'hono';

import type { Database } from './db/client.js';
import { health } from './routes/health.js';
import { runs } from './routes/runs.js';
import { tasks } from './routes/tasks.js';

export function createApp(database: Database): Hono {
  const app = new Hono();
  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: { code: 'internal', message: 'Unexpected error' } }, 500);
  });
  app.route('/health', health(database));
  app.route('/tasks', tasks(database));
  app.route('/runs', runs(database));
  return app;
}
""",
    "src/db/client.ts": """\
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema.js';

export type Database = ReturnType<typeof connect>;

export function connect(url: string) {
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  return drizzle(pool, { schema });
}
""",
    "src/db/schema.ts": """\
import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey(),
  title: text('title').notNull(),
  request: text('request').notNull(),
  status: text('status').notNull().default('queued'),
  maxMinutes: integer('max_minutes').notNull().default(60),
  maxRetries: integer('max_retries').notNull().default(2),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const runs = pgTable('runs', {
  id: uuid('id').primaryKey(),
  taskId: uuid('task_id').notNull(),
  attempt: integer('attempt').notNull().default(1),
  status: text('status').notNull().default('queued'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});
""",
    "src/lib/budget.ts": """\
export interface Budget {
  maxMinutes: number;
  maxRetries: number;
}

export interface Spent {
  minutes: number;
  attempts: number;
}

/** Whether a run may be attempted again without going past its budget. */
export function allowsAnotherAttempt(budget: Budget, spent: Spent): boolean {
  if (spent.minutes >= budget.maxMinutes) {
    return false;
  }
  // The first attempt is not a retry.
  return spent.attempts - 1 < budget.maxRetries;
}

export function remainingMinutes(budget: Budget, spent: Spent): number {
  return Math.max(0, budget.maxMinutes - spent.minutes);
}
""",
    "src/lib/retry.ts": """\
const BASE_MS = 500;
const CEILING_MS = 60_000;

/** How long to wait before attempt `attempt`, counted from one. */
export function delayBefore(attempt: number): number {
  if (attempt <= 1) {
    return 0;
  }
  return Math.min(CEILING_MS, BASE_MS * 2 ** (attempt - 2));
}

export async function retrying<T>(
  attempts: number,
  work: (attempt: number) => Promise<T>,
): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, delayBefore(attempt)));
    try {
      return await work(attempt);
    } catch (error) {
      last = error;
    }
  }
  throw last;
}
""",
    "src/routes/health.ts": """\
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';

import type { Database } from '../db/client.js';

export function health(database: Database): Hono {
  const router = new Hono();
  router.get('/', async (c) => {
    try {
      await database.execute(sql`select 1`);
      return c.json({ status: 'ok' });
    } catch {
      return c.json({ status: 'degraded' }, 503);
    }
  });
  return router;
}
""",
    "src/routes/runs.ts": """\
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import type { Database } from '../db/client.js';
import { runs as table } from '../db/schema.js';

export function runs(database: Database): Hono {
  const router = new Hono();
  router.get('/:id', async (c) => {
    const [run] = await database
      .select()
      .from(table)
      .where(eq(table.id, c.req.param('id')));
    if (!run) {
      return c.json({ error: { code: 'not_found', message: 'No such run' } }, 404);
    }
    return c.json(run);
  });
  return router;
}
""",
    "src/routes/tasks.ts": """\
import { randomUUID } from 'node:crypto';

import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { Database } from '../db/client.js';
import { runs, tasks as table } from '../db/schema.js';

const NewTask = z.object({
  title: z.string().min(3).max(120),
  request: z.string().min(10),
  maxMinutes: z.number().int().min(5).max(480).default(60),
  maxRetries: z.number().int().min(0).max(5).default(2),
});

export function tasks(database: Database): Hono {
  const router = new Hono();

  router.get('/', async (c) => {
    const items = await database
      .select()
      .from(table)
      .orderBy(desc(table.createdAt))
      .limit(50);
    return c.json({ items });
  });

  router.post('/', async (c) => {
    const parsed = NewTask.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: { code: 'invalid', message: 'Invalid task' } }, 400);
    }
    const id = randomUUID();
    await database.transaction(async (tx) => {
      await tx.insert(table).values({ id, ...parsed.data });
      await tx.insert(runs).values({ id: randomUUID(), taskId: id });
    });
    return c.json({ id }, 201);
  });

  router.get('/:id', async (c) => {
    const [task] = await database
      .select()
      .from(table)
      .where(eq(table.id, c.req.param('id')));
    if (!task) {
      return c.json({ error: { code: 'not_found', message: 'No such task' } }, 404);
    }
    return c.json(task);
  });

  return router;
}
""",
    "test/budget.test.ts": """\
import { describe, expect, it } from 'vitest';

import { allowsAnotherAttempt, remainingMinutes } from '../src/lib/budget.js';

describe('budget', () => {
  const budget = { maxMinutes: 60, maxRetries: 2 };

  it('allows retries until they are spent', () => {
    expect(allowsAnotherAttempt(budget, { minutes: 5, attempts: 1 })).toBe(true);
    expect(allowsAnotherAttempt(budget, { minutes: 5, attempts: 3 })).toBe(false);
  });

  it('stops at the time budget whatever the attempts', () => {
    expect(allowsAnotherAttempt(budget, { minutes: 60, attempts: 1 })).toBe(false);
    expect(remainingMinutes(budget, { minutes: 75, attempts: 1 })).toBe(0);
  });
});
""",
    "test/retry.test.ts": """\
import { describe, expect, it } from 'vitest';

import { delayBefore } from '../src/lib/retry.js';

describe('delayBefore', () => {
  it('does not wait before the first attempt', () => {
    expect(delayBefore(1)).toBe(0);
  });

  it('doubles, up to a ceiling', () => {
    expect(delayBefore(2)).toBe(500);
    expect(delayBefore(3)).toBe(1000);
    expect(delayBefore(40)).toBe(60_000);
  });
});
""",
}

FORGEMIND_WEB = {
    "README.md": """\
# ForgeMind Web

The interface: the task board, a task's run as it happens, and the review
of what a run produced.

    pnpm install
    pnpm dev

It expects the API at `NEXT_PUBLIC_API_URL`.
""",
    "package.json": """\
{
  "name": "@forgemind/web",
  "version": "0.4.0",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "e2e": "playwright test"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.0",
    "@types/react": "^19.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
""",
    "pnpm-lock.yaml": PNPM_LOCK,
    "next.config.ts": """\
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default config;
""",
    "tsconfig.json": """\
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "jsx": "preserve",
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src", "next-env.d.ts"]
}
""",
    "src/app/globals.css": """\
@import 'tailwindcss';

:root {
  --surface: #0b0d12;
  --surface-raised: #141821;
  --text: #e8ecf3;
  --text-muted: #9aa4b5;
  --accent: #6ea8fe;
  --radius: 12px;
}

body {
  margin: 0;
  background: var(--surface);
  color: var(--text);
  font-family: system-ui, sans-serif;
}

.card {
  background: var(--surface-raised);
  border-radius: var(--radius);
  padding: 16px 20px;
}

.muted {
  color: var(--text-muted);
}
""",
    "src/app/layout.tsx": """\
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'ForgeMind',
  description: 'Tasks, runs and reviews.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main className="mx-auto max-w-4xl p-6">{children}</main>
      </body>
    </html>
  );
}
""",
    "src/app/page.tsx": """\
import Link from 'next/link';

import { TaskList } from '@/components/task-list';
import { listTasks } from '@/lib/api';

export default async function Home() {
  const tasks = await listTasks();
  return (
    <section>
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tasks</h1>
        <Link href="/tasks/new">New task</Link>
      </header>
      <TaskList tasks={tasks} />
    </section>
  );
}
""",
    "src/app/tasks/[id]/page.tsx": """\
import { notFound } from 'next/navigation';

import { StatusBadge } from '@/components/status-badge';
import { getTask } from '@/lib/api';

export default async function TaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const task = await getTask(id);
  if (!task) {
    notFound();
  }
  return (
    <article className="card">
      <h1 className="text-xl font-semibold">{task.title}</h1>
      <StatusBadge status={task.status} />
      <p className="muted">{task.request}</p>
    </article>
  );
}
""",
    "src/components/status-badge.tsx": """\
import type { TaskStatus } from '@/lib/api';

const LABELS: Record<TaskStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  awaiting_review: 'Awaiting review',
  completed: 'Completed',
  failed: 'Failed',
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className="rounded-full px-2 py-0.5 text-sm" data-status={status}>
      {LABELS[status]}
    </span>
  );
}
""",
    "src/components/task-list.tsx": """\
import Link from 'next/link';

import type { Task } from '@/lib/api';

import { StatusBadge } from './status-badge';

export function TaskList({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) {
    return <p className="muted">No tasks yet.</p>;
  }
  return (
    <ul className="grid gap-3">
      {tasks.map((task) => (
        <li key={task.id} className="card">
          <Link href={`/tasks/${task.id}`}>{task.title}</Link>
          <StatusBadge status={task.status} />
        </li>
      ))}
    </ul>
  );
}
""",
    "src/lib/api.ts": """\
export type TaskStatus =
  | 'queued'
  | 'running'
  | 'awaiting_review'
  | 'completed'
  | 'failed';

export interface Task {
  id: string;
  title: string;
  request: string;
  status: TaskStatus;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function get<T>(path: string): Promise<T | null> {
  const response = await fetch(`${API}${path}`, { cache: 'no-store' });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`${path} answered ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function listTasks(): Promise<Task[]> {
  return (await get<{ items: Task[] }>('/tasks'))?.items ?? [];
}

export function getTask(id: string): Promise<Task | null> {
  return get<Task>(`/tasks/${encodeURIComponent(id)}`);
}
""",
    "src/lib/api.test.ts": """\
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getTask, listTasks } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  it('reads a missing task as nothing', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    expect(await getTask('nope')).toBeNull();
  });

  it('lists what the API returns', async () => {
    const items = [{ id: '1', title: 'A', request: 'B', status: 'queued' }];
    vi.stubGlobal('fetch', async () => Response.json({ items }));
    expect(await listTasks()).toEqual(items);
  });
});
""",
    "e2e/tasks.spec.ts": """\
import { expect, test } from '@playwright/test';

test('the board lists tasks and opens one', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();
  await page.getByRole('link').first().click();
  await expect(page).toHaveURL(/\\/tasks\\//);
});
""",
}

FORGEMIND_WORKERS = {
    "README.md": """\
# ForgeMind Workers

The processes that execute runs. A worker takes a run from the queue, works
on it inside a sandbox, and reports what happened.

    uv sync
    uv run forgemind-workers
""",
    "pyproject.toml": """\
[project]
name = "forgemind-workers"
version = "0.4.0"
requires-python = ">=3.12"
dependencies = [
    "celery>=5.4",
    "httpx>=0.27",
    "pydantic>=2.9",
    "redis>=5.1",
]

[project.scripts]
forgemind-workers = "workers.cli:main"

[dependency-groups]
dev = [
    "pytest>=8.3",
    "ruff>=0.7",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/workers"]
""",
    "uv.lock": """\
version = 1
requires-python = ">=3.12"
""",
    "Dockerfile": """\
FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev

FROM python:3.12-slim
RUN useradd --uid 10001 --create-home worker
WORKDIR /app
COPY --from=build /app/.venv ./.venv
COPY --from=build /app/src ./src
COPY scripts/entrypoint.sh /usr/local/bin/entrypoint
ENV PATH="/app/.venv/bin:$PATH"
USER worker
ENTRYPOINT ["entrypoint"]
CMD ["worker"]
""",
    "scripts/entrypoint.sh": """\
#!/usr/bin/env sh
set -eu

case "${1:-worker}" in
  worker)
    exec celery --app workers.celery_app worker --concurrency "${CONCURRENCY:-2}"
    ;;
  beat)
    exec celery --app workers.celery_app beat
    ;;
  *)
    exec "$@"
    ;;
esac
""",
    "src/workers/__init__.py": """\
\"\"\"The processes that execute ForgeMind runs.\"\"\"

__version__ = "0.4.0"
""",
    "src/workers/celery_app.py": """\
\"\"\"The Celery application the workers and the scheduler share.\"\"\"

import os

from celery import Celery

app = Celery(
    "workers",
    broker=os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
    include=["workers.tasks"],
)
app.conf.update(
    task_acks_late=True,
    task_ignore_result=True,
    worker_prefetch_multiplier=1,
    timezone="UTC",
)
""",
    "src/workers/tasks.py": """\
\"\"\"What a worker does with a run.\"\"\"

import logging

from workers.budget import Budget, Spent
from workers.celery_app import app
from workers.report import Reporter
from workers.sandbox import Sandbox

log = logging.getLogger(__name__)


@app.task(name="runs.execute", bind=True, max_retries=None)
def execute(self, run_id: str, max_minutes: int, max_retries: int) -> str:
    budget = Budget(max_minutes=max_minutes, max_retries=max_retries)
    spent = Spent(attempts=self.request.retries + 1)
    reporter = Reporter(run_id)
    with Sandbox(run_id) as sandbox:
        result = sandbox.run(["make", "test"], minutes=budget.remaining(spent))
    spent.minutes += result.minutes
    if result.ok:
        reporter.finished("passed")
        return "passed"
    if budget.allows_another_attempt(spent):
        log.info("retrying run %s", run_id)
        raise self.retry(countdown=budget.delay_before(spent.attempts + 1))
    reporter.finished("failed")
    return "failed"
""",
    "src/workers/budget.py": """\
\"\"\"How much a run may spend, and whether it may try again.\"\"\"

from dataclasses import dataclass


@dataclass(frozen=True)
class Budget:
    max_minutes: int
    max_retries: int

    def remaining(self, spent: "Spent") -> float:
        return max(0.0, self.max_minutes - spent.minutes)

    def allows_another_attempt(self, spent: "Spent") -> bool:
        if spent.minutes >= self.max_minutes:
            return False
        # The first attempt is not a retry.
        return spent.attempts - 1 < self.max_retries

    def delay_before(self, attempt: int) -> float:
        if attempt <= 1:
            return 0.0
        return min(60.0, 0.5 * 2 ** (attempt - 2))


@dataclass
class Spent:
    attempts: int = 1
    minutes: float = 0.0
""",
    "src/workers/sandbox.py": """\
\"\"\"Where a run's commands execute: a container with no network and no
credentials, removed when the run is done.\"\"\"

import subprocess
import time
from dataclasses import dataclass
from types import TracebackType


@dataclass(frozen=True)
class Result:
    ok: bool
    minutes: float
    output: str


class Sandbox:
    def __init__(self, run_id: str, image: str = "forgemind/sandbox:latest") -> None:
        self.name = f"run-{run_id}"
        self.image = image

    def __enter__(self) -> "Sandbox":
        subprocess.run(
            ["docker", "create", "--name", self.name, "--network", "none", self.image],
            check=True,
            capture_output=True,
        )
        return self

    def __exit__(
        self,
        kind: type[BaseException] | None,
        error: BaseException | None,
        trace: TracebackType | None,
    ) -> None:
        subprocess.run(["docker", "rm", "--force", self.name], capture_output=True)

    def run(self, command: list[str], minutes: float) -> Result:
        started = time.monotonic()
        try:
            done = subprocess.run(
                ["docker", "exec", self.name, *command],
                capture_output=True,
                text=True,
                timeout=minutes * 60,
            )
            ok, output = done.returncode == 0, done.stdout + done.stderr
        except subprocess.TimeoutExpired:
            ok, output = False, "Stopped at the time budget."
        return Result(ok, (time.monotonic() - started) / 60, output)
""",
    "src/workers/report.py": """\
\"\"\"Tells the API what happened to a run.\"\"\"

import os

import httpx
from pydantic import BaseModel


class Finished(BaseModel):
    run_id: str
    status: str


class Reporter:
    def __init__(self, run_id: str) -> None:
        self.run_id = run_id
        self.api = os.environ.get("API_URL", "http://localhost:4000")

    def finished(self, status: str) -> None:
        body = Finished(run_id=self.run_id, status=status)
        response = httpx.post(
            f"{self.api}/runs/{self.run_id}/finished",
            json=body.model_dump(),
            timeout=10,
        )
        response.raise_for_status()
""",
    "src/workers/cli.py": """\
\"\"\"`forgemind-workers`: starts a worker in this process.\"\"\"

import sys

from workers.celery_app import app


def main() -> int:
    arguments = sys.argv[1:] or ["worker", "--concurrency", "2"]
    app.worker_main(arguments)
    return 0


if __name__ == "__main__":
    sys.exit(main())
""",
    "tests/test_budget.py": """\
from workers.budget import Budget, Spent


def test_retries_are_allowed_until_they_are_spent() -> None:
    budget = Budget(max_minutes=60, max_retries=2)
    assert budget.allows_another_attempt(Spent(attempts=1, minutes=5))
    assert budget.allows_another_attempt(Spent(attempts=2, minutes=5))
    assert not budget.allows_another_attempt(Spent(attempts=3, minutes=5))


def test_the_time_budget_stops_a_run_whatever_its_attempts() -> None:
    budget = Budget(max_minutes=60, max_retries=2)
    assert not budget.allows_another_attempt(Spent(attempts=1, minutes=60))
    assert budget.remaining(Spent(attempts=1, minutes=75)) == 0


def test_attempts_are_spaced_out_up_to_a_ceiling() -> None:
    budget = Budget(max_minutes=60, max_retries=2)
    assert budget.delay_before(1) == 0
    assert budget.delay_before(2) == 0.5
    assert budget.delay_before(40) == 60
""",
}

ACME_PAYMENTS = {
    "README.md": """\
# payments

Takes card payments through Stripe and keeps the ledger that says who paid
what. One binary, `cmd/payments`, serving HTTP.

    make test
    make build
""",
    "Makefile": """\
.PHONY: test build plan

test:
\tgo test ./...

build:
\tgo build -o bin/payments ./cmd/payments

plan:
\tterraform -chdir=deploy plan
""",
    "go.mod": """\
module github.com/acme/payments

go 1.23

require (
\tgithub.com/go-chi/chi/v5 v5.1.0
\tgithub.com/jackc/pgx/v5 v5.7.1
\tgo.uber.org/zap v1.27.0
)

require (
\tgithub.com/jackc/pgpassfile v1.0.0 // indirect
\tgo.uber.org/multierr v1.11.0 // indirect
)
""",
    "go.sum": """\
github.com/go-chi/chi/v5 v5.1.0 h1:acVI1TYaD+hhedDJ3r54HyA6sExp3HfXq7QWEEY/xMw=
github.com/go-chi/chi/v5 v5.1.0/go.mod h1:DslCQbL2OYiznFReuXYUmQ2hGd1aDpCnlMNITLSKoi8=
github.com/jackc/pgx/v5 v5.7.1 h1:x7SYsPBYDkHDksogeSmZZ5xzThcTgRz++I5E+ePFUcs=
github.com/jackc/pgx/v5 v5.7.1/go.mod h1:e7O26IywZZ+naJtWWos6i6fvWK+29etgITqrqHLfoZA=
go.uber.org/zap v1.27.0 h1:aJMhYGrd5QSmlpLMr2MftRKl7t8J8PTZPA732ud/XR8=
go.uber.org/zap v1.27.0/go.mod h1:GB2qFLM7cTU87MWRP2mPIjqfIDnGu+VIO4V/SdhGo2E=
""",
    "cmd/payments/main.go": """\
package main

import (
\t"context"
\t"net/http"
\t"os"
\t"time"

\t"github.com/jackc/pgx/v5/pgxpool"
\t"go.uber.org/zap"

\t"github.com/acme/payments/internal/api"
\t"github.com/acme/payments/internal/ledger"
\t"github.com/acme/payments/internal/stripe"
)

func main() {
\tlog, _ := zap.NewProduction()
\tdefer log.Sync()

\tpool, err := pgxpool.New(context.Background(), os.Getenv("DATABASE_URL"))
\tif err != nil {
\t\tlog.Fatal("database", zap.Error(err))
\t}
\tdefer pool.Close()

\tserver := &http.Server{
\t\tAddr: ":" + envOr("PORT", "8080"),
\t\tHandler: api.Router(
\t\t\tledger.New(pool),
\t\t\tstripe.New(os.Getenv("STRIPE_SECRET_KEY")),
\t\t\tlog,
\t\t),
\t\tReadHeaderTimeout: 5 * time.Second,
\t}
\tlog.Info("listening", zap.String("addr", server.Addr))
\tif err := server.ListenAndServe(); err != nil {
\t\tlog.Fatal("server", zap.Error(err))
\t}
}

func envOr(name, fallback string) string {
\tif value := os.Getenv(name); value != "" {
\t\treturn value
\t}
\treturn fallback
}
""",
    "internal/api/router.go": """\
// Package api is the HTTP surface of the payments service.
package api

import (
\t"encoding/json"
\t"net/http"

\t"github.com/go-chi/chi/v5"
\t"github.com/go-chi/chi/v5/middleware"
\t"go.uber.org/zap"

\t"github.com/acme/payments/internal/ledger"
\t"github.com/acme/payments/internal/stripe"
)

type chargeRequest struct {
\tCustomer string `json:"customer"`
\tAmount   int64  `json:"amount"`
\tCurrency string `json:"currency"`
}

// Router wires the routes to the ledger and to Stripe.
func Router(book *ledger.Ledger, cards *stripe.Client, log *zap.Logger) http.Handler {
\trouter := chi.NewRouter()
\trouter.Use(middleware.RequestID, middleware.Recoverer)

\trouter.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
\t\tw.WriteHeader(http.StatusNoContent)
\t})

\trouter.Post("/charges", func(w http.ResponseWriter, r *http.Request) {
\t\tvar body chargeRequest
\t\tif err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Amount <= 0 {
\t\t\thttp.Error(w, "invalid charge", http.StatusBadRequest)
\t\t\treturn
\t\t}
\t\treference, err := cards.Charge(r.Context(), stripe.Payment{
\t\t\tCustomer: body.Customer, Amount: body.Amount, Currency: body.Currency,
\t\t})
\t\tif err != nil {
\t\t\tlog.Warn("charge refused", zap.Error(err))
\t\t\thttp.Error(w, "charge refused", http.StatusPaymentRequired)
\t\t\treturn
\t\t}
\t\tentry := ledger.Entry{
\t\t\tCustomer: body.Customer, Amount: body.Amount,
\t\t\tCurrency: body.Currency, Reference: reference,
\t\t}
\t\tif err := book.Record(r.Context(), entry); err != nil {
\t\t\tlog.Error("ledger", zap.Error(err))
\t\t\thttp.Error(w, "not recorded", http.StatusInternalServerError)
\t\t\treturn
\t\t}
\t\tw.WriteHeader(http.StatusCreated)
\t\t_ = json.NewEncoder(w).Encode(entry)
\t})

\trouter.Get("/customers/{id}/balance", func(w http.ResponseWriter, r *http.Request) {
\t\tbalance, err := book.Balance(r.Context(), chi.URLParam(r, "id"))
\t\tif err != nil {
\t\t\thttp.Error(w, "not found", http.StatusNotFound)
\t\t\treturn
\t\t}
\t\t_ = json.NewEncoder(w).Encode(map[string]int64{"balance": balance})
\t})

\treturn router
}
""",
    "internal/ledger/ledger.go": """\
// Package ledger records what each customer has paid.
package ledger

import (
\t"context"
\t"errors"

\t"github.com/jackc/pgx/v5/pgxpool"
)

// ErrDuplicate means the payment reference was recorded before.
var ErrDuplicate = errors.New("ledger: reference already recorded")

// Entry is one payment.
type Entry struct {
\tCustomer  string `json:"customer"`
\tAmount    int64  `json:"amount"`
\tCurrency  string `json:"currency"`
\tReference string `json:"reference"`
}

// Ledger stores entries in PostgreSQL.
type Ledger struct {
\tpool *pgxpool.Pool
}

// New returns a ledger on the given pool.
func New(pool *pgxpool.Pool) *Ledger {
\treturn &Ledger{pool: pool}
}

// Record writes an entry once: a reference seen before is refused.
func (l *Ledger) Record(ctx context.Context, entry Entry) error {
\ttag, err := l.pool.Exec(ctx,
\t\t`INSERT INTO entries (customer, amount, currency, reference)
\t\t VALUES ($1, $2, $3, $4) ON CONFLICT (reference) DO NOTHING`,
\t\tentry.Customer, entry.Amount, entry.Currency, entry.Reference)
\tif err != nil {
\t\treturn err
\t}
\tif tag.RowsAffected() == 0 {
\t\treturn ErrDuplicate
\t}
\treturn nil
}

// Balance is everything a customer has paid, in the smallest unit.
func (l *Ledger) Balance(ctx context.Context, customer string) (int64, error) {
\tvar total int64
\terr := l.pool.QueryRow(ctx,
\t\t`SELECT COALESCE(SUM(amount), 0) FROM entries WHERE customer = $1`,
\t\tcustomer).Scan(&total)
\treturn total, err
}

// Split divides an amount into parts that add up to it exactly.
func Split(amount int64, parts int) []int64 {
\tif parts <= 0 {
\t\treturn nil
\t}
\tshares := make([]int64, parts)
\tbase, extra := amount/int64(parts), amount%int64(parts)
\tfor i := range shares {
\t\tshares[i] = base
\t\tif int64(i) < extra {
\t\t\tshares[i]++
\t\t}
\t}
\treturn shares
}
""",
    "internal/ledger/ledger_test.go": """\
package ledger

import "testing"

func TestSplitAddsUpToTheAmount(t *testing.T) {
\tfor _, amount := range []int64{0, 1, 99, 100, 1001} {
\t\tfor parts := 1; parts <= 7; parts++ {
\t\t\tvar total int64
\t\t\tfor _, share := range Split(amount, parts) {
\t\t\t\ttotal += share
\t\t\t}
\t\t\tif total != amount {
\t\t\t\tt.Fatalf("Split(%d, %d) adds up to %d", amount, parts, total)
\t\t\t}
\t\t}
\t}
}

func TestSplitIntoNothing(t *testing.T) {
\tif got := Split(100, 0); got != nil {
\t\tt.Fatalf("Split(100, 0) = %v, want nil", got)
\t}
}
""",
    "internal/stripe/client.go": """\
// Package stripe charges cards through Stripe's API.
package stripe

import (
\t"context"
\t"encoding/json"
\t"fmt"
\t"net/http"
\t"net/url"
\t"strconv"
\t"strings"
)

// Client holds the secret key and nothing else.
type Client struct {
\tkey  string
\thttp *http.Client
}

// New returns a client that authenticates with key.
func New(key string) *Client {
\treturn &Client{key: key, http: http.DefaultClient}
}

// Payment is what to take, and from whom.
type Payment struct {
\tCustomer string
\tAmount   int64
\tCurrency string
}

// Charge takes the payment from the customer's default card and returns
// Stripe's reference for it.
func (c *Client) Charge(ctx context.Context, payment Payment) (string, error) {
\tform := url.Values{
\t\t"customer": {payment.Customer},
\t\t"amount":   {strconv.FormatInt(payment.Amount, 10)},
\t\t"currency": {payment.Currency},
\t\t"confirm":  {"true"},
\t}
\trequest, err := http.NewRequestWithContext(ctx, http.MethodPost,
\t\t"https://api.stripe.com/v1/payment_intents", strings.NewReader(form.Encode()))
\tif err != nil {
\t\treturn "", err
\t}
\trequest.SetBasicAuth(c.key, "")
\trequest.Header.Set("Content-Type", "application/x-www-form-urlencoded")
\tresponse, err := c.http.Do(request)
\tif err != nil {
\t\treturn "", err
\t}
\tdefer response.Body.Close()
\tif response.StatusCode >= 300 {
\t\treturn "", fmt.Errorf("stripe: status %d", response.StatusCode)
\t}
\tvar intent struct {
\t\tID string `json:"id"`
\t}
\tif err := json.NewDecoder(response.Body).Decode(&intent); err != nil {
\t\treturn "", err
\t}
\treturn intent.ID, nil
}
""",
    "deploy/main.tf": """\
terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }
}

provider "aws" {
  region = var.region
}

resource "aws_ecs_service" "payments" {
  name            = "payments"
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.payments.arn
  desired_count   = var.instances
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.private_subnets
    security_groups = [aws_security_group.payments.id]
  }
}

resource "aws_ecs_task_definition" "payments" {
  family                   = "payments"
  cpu                      = 256
  memory                   = 512
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  container_definitions = jsonencode([{
    name         = "payments"
    image        = var.image
    portMappings = [{ containerPort = 8080 }]
  }])
}

resource "aws_security_group" "payments" {
  name   = "payments"
  vpc_id = var.vpc_id
}
""",
    "deploy/variables.tf": """\
variable "region" {
  type    = string
  default = "eu-west-1"
}

variable "cluster_arn" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnets" {
  type = list(string)
}

variable "image" {
  type = string
}

variable "instances" {
  type    = number
  default = 2
}
""",
}

ACME_LEGACY_PORTAL = {
    "README.md": """\
# Legacy portal

The customer portal from before the rewrite. Still serves account pages
for customers who have not been migrated.

Deployed by copying the tree to the web server. There are no tests.
""",
    "composer.json": """\
{
  "name": "acme/legacy-portal",
  "type": "project",
  "require": {
    "php": ">=7.4",
    "ext-pdo": "*",
    "monolog/monolog": "^2.9",
    "twig/twig": "^3.8"
  },
  "autoload": {
    "psr-4": { "Portal\\\\": "src/Portal/" }
  }
}
""",
    "public/index.php": r"""<?php

require __DIR__ . '/../vendor/autoload.php';

use Portal\Controllers\AccountController;
use Portal\Db;
use Portal\Router;

session_start();

$router = new Router();
$accounts = new AccountController(new Db(getenv('PORTAL_DSN')));

$router->get('/', function () {
    header('Location: /account');
});
$router->get('/account', [$accounts, 'show']);
$router->post('/account/email', [$accounts, 'changeEmail']);

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$router->dispatch($_SERVER['REQUEST_METHOD'], $path);
""",
    "public/assets/app.js": """\
(function () {
  var form = document.querySelector('form[data-confirm]');
  if (!form) {
    return;
  }
  form.addEventListener('submit', function (event) {
    if (!window.confirm(form.getAttribute('data-confirm'))) {
      event.preventDefault();
    }
  });
})();
""",
    "src/Portal/Router.php": r"""<?php

namespace Portal;

class Router
{
    private $routes = [];

    public function get($path, $handler)
    {
        $this->routes['GET'][$path] = $handler;
    }

    public function post($path, $handler)
    {
        $this->routes['POST'][$path] = $handler;
    }

    public function dispatch($method, $path)
    {
        if (!isset($this->routes[$method][$path])) {
            http_response_code(404);
            echo 'Not found';
            return;
        }
        call_user_func($this->routes[$method][$path]);
    }
}
""",
    "src/Portal/Db.php": r"""<?php

namespace Portal;

use PDO;

class Db
{
    private $pdo;

    public function __construct($dsn)
    {
        $this->pdo = new PDO($dsn);
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    }

    public function one($sql, array $params = [])
    {
        $statement = $this->pdo->prepare($sql);
        $statement->execute($params);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        return $row === false ? null : $row;
    }

    public function run($sql, array $params = [])
    {
        $statement = $this->pdo->prepare($sql);
        $statement->execute($params);
        return $statement->rowCount();
    }
}
""",
    "src/Portal/Controllers/AccountController.php": r"""<?php

namespace Portal\Controllers;

use Portal\Db;

class AccountController
{
    private $db;

    public function __construct(Db $db)
    {
        $this->db = $db;
    }

    public function show()
    {
        $account = $this->current();
        if ($account === null) {
            header('Location: /login');
            return;
        }
        echo '<h1>' . htmlspecialchars($account['name']) . '</h1>';
        echo '<p>' . htmlspecialchars($account['email']) . '</p>';
        echo '<form method="post" action="/account/email" data-confirm="Change it?">';
        echo '<input name="email" type="email" required>';
        echo '<button>Change email</button></form>';
    }

    public function changeEmail()
    {
        $account = $this->current();
        $email = filter_input(INPUT_POST, 'email', FILTER_VALIDATE_EMAIL);
        if ($account === null || !$email) {
            http_response_code(400);
            return;
        }
        $this->db->run(
            'UPDATE accounts SET email = ? WHERE id = ?',
            [$email, $account['id']]
        );
        header('Location: /account');
    }

    private function current()
    {
        if (empty($_SESSION['account_id'])) {
            return null;
        }
        return $this->db->one(
            'SELECT id, name, email FROM accounts WHERE id = ?',
            [$_SESSION['account_id']]
        );
    }
}
""",
}

FORGEMIND_DOCS = {
    "README.md": """\
# ForgeMind documentation

The source of the documentation site. Pages are MDX files under `docs/`.

    pnpm install
    pnpm dev
""",
    "package.json": """\
{
  "name": "@forgemind/docs",
  "version": "0.4.0",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build"
  },
  "dependencies": {
    "next": "^15.0.0",
    "nextra": "^3.2.0",
    "nextra-theme-docs": "^3.2.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
""",
    "pnpm-lock.yaml": PNPM_LOCK,
    "next.config.mjs": """\
import nextra from 'nextra';

const withNextra = nextra({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.tsx',
});

export default withNextra({ pageExtensions: ['mdx', 'tsx'] });
""",
    "theme.config.tsx": """\
import type { DocsThemeConfig } from 'nextra-theme-docs';

const config: DocsThemeConfig = {
  logo: <strong>ForgeMind</strong>,
  docsRepositoryBase: 'https://github.com/forgemind/docs/tree/main',
  footer: { content: 'ForgeMind documentation' },
};

export default config;
""",
    "docs/index.mdx": """\
---
title: Introduction
---

# Introduction

ForgeMind takes a task you describe, works on it in a copy of your
repository, checks the result with your own tests, and opens a pull request
for you to review. Nothing is merged for you.

## What to read first

- [Getting started](./getting-started) connects a repository and runs a task.
- [Runs](./concepts/runs) explains what happens between asking and reviewing.
- [Verification](./concepts/verification) says what "verified" means here.
""",
    "docs/getting-started.mdx": """\
---
title: Getting started
---

# Getting started

## Connect a repository

Install the ForgeMind GitHub App on the account that owns the repository,
then choose the repository from the list. ForgeMind reads it once to learn
its languages, how it is tested and how it is built.

## Describe a task

Say what should change and how you would know it worked. A good task names
the behaviour, not the files:

> Stop retrying a run once its time budget is spent.

## Review the result

When the run finishes you get a pull request with the change, the checks
that ran, and what they reported. Approve it, ask for changes, or close it.
""",
    "docs/concepts/runs.mdx": """\
---
title: Runs
---

# Runs

A run is one attempt at a task. It moves through stages, and each stage is
recorded as it happens, so what you read afterwards is what took place.

| Stage        | What happens                                        |
| ------------ | --------------------------------------------------- |
| Inspection   | The repository is read at the commit the run uses.  |
| Planning     | The change is planned before any file is touched.   |
| Implementing | The change is made in an isolated copy.             |
| Verification | Your tests and checks run against the change.       |
| Review       | The result waits for a person.                      |

## Budgets

Every run has a time budget and a number of retries. A run that reaches
either stops and says so.
""",
    "docs/concepts/verification.mdx": """\
---
title: Verification
---

# Verification

A change is called verified only when the checks the repository requires
were run against it and passed. A check that could not run is reported as
not run, never as passed.

## What is shown

- The command each check ran, and how long it took.
- Its output, as produced.
- Whether the result was confirmed by a tool or is a suspicion.
""",
    "docs/reference/api.mdx": """\
---
title: API reference
---

# API reference

The API is JSON over HTTPS. Every request is made as a signed-in person, and
sees only that person's organization.

## Tasks

`POST /tasks` creates a task and its first run.

```json
{
  "repositoryId": "8b6e5c0e-6c1b-4c8f-9a51-0d6f2f1f8a11",
  "title": "Stop retrying past the budget",
  "request": "A run must not start another attempt once its time is spent."
}
```

`GET /tasks/:id` returns the task and the id of its current run.

## Runs

`GET /runs/:id/events` returns what has happened in a run, in order.
""",
}

FORGEMIND_INFRA = {
    "README.md": """\
# Infrastructure

Terraform for the staging and production environments. Each environment
composes the modules under `modules/`.

    ./scripts/plan.sh staging
    ./scripts/apply.sh staging
""",
    ".github/workflows/plan.yml": """\
name: Plan
on:
  pull_request:
jobs:
  plan:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        environment: [staging, production]
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
      - run: ./scripts/plan.sh ${{ matrix.environment }}
""",
    "modules/network/main.tf": """\
variable "name" {
  type = string
}

variable "cidr" {
  type    = string
  default = "10.20.0.0/16"
}

resource "aws_vpc" "this" {
  cidr_block           = var.cidr
  enable_dns_hostnames = true
  tags                 = { Name = var.name }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.this.id
  cidr_block        = cidrsubnet(var.cidr, 4, count.index)
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags              = { Name = "${var.name}-private-${count.index}" }
}

data "aws_availability_zones" "available" {
  state = "available"
}

output "vpc_id" {
  value = aws_vpc.this.id
}

output "private_subnets" {
  value = aws_subnet.private[*].id
}
""",
    "modules/database/main.tf": """\
variable "name" {
  type = string
}

variable "subnets" {
  type = list(string)
}

variable "instance_class" {
  type    = string
  default = "db.t4g.small"
}

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnets
}

resource "aws_db_instance" "this" {
  identifier                  = var.name
  engine                      = "postgres"
  engine_version              = "17"
  instance_class              = var.instance_class
  allocated_storage           = 20
  db_subnet_group_name        = aws_db_subnet_group.this.name
  manage_master_user_password = true
  username                    = "forgemind"
  storage_encrypted           = true
  deletion_protection         = true
  backup_retention_period     = 7
}

output "endpoint" {
  value = aws_db_instance.this.endpoint
}
""",
    "envs/staging/main.tf": """\
terraform {
  required_version = ">= 1.9"
  backend "s3" {
    bucket = "forgemind-terraform-state"
    key    = "staging/terraform.tfstate"
    region = "eu-west-1"
  }
}

provider "aws" {
  region = "eu-west-1"
}

module "network" {
  source = "../../modules/network"
  name   = "forgemind-staging"
}

module "database" {
  source  = "../../modules/database"
  name    = "forgemind-staging"
  subnets = module.network.private_subnets
}
""",
    "envs/production/main.tf": """\
terraform {
  required_version = ">= 1.9"
  backend "s3" {
    bucket = "forgemind-terraform-state"
    key    = "production/terraform.tfstate"
    region = "eu-west-1"
  }
}

provider "aws" {
  region = "eu-west-1"
}

module "network" {
  source = "../../modules/network"
  name   = "forgemind-production"
  cidr   = "10.30.0.0/16"
}

module "database" {
  source         = "../../modules/database"
  name           = "forgemind-production"
  subnets        = module.network.private_subnets
  instance_class = "db.m7g.large"
}
""",
    "scripts/plan.sh": """\
#!/usr/bin/env sh
# Plans one environment: ./scripts/plan.sh staging
set -eu

environment="${1:?usage: plan.sh <environment>}"
cd "envs/$environment"
terraform init -input=false
terraform plan -input=false -out=plan.tfplan
""",
    "scripts/apply.sh": """\
#!/usr/bin/env sh
# Applies the plan made by plan.sh, after asking.
set -eu

environment="${1:?usage: apply.sh <environment>}"
cd "envs/$environment"
if [ ! -f plan.tfplan ]; then
  echo "no plan for $environment; run plan.sh first" >&2
  exit 1
fi
printf 'Apply the plan to %s? [y/N] ' "$environment"
read -r answer
[ "$answer" = "y" ] || exit 1
terraform apply -input=false plan.tfplan
rm plan.tfplan
""",
}

FORGEMIND_CLI = {
    "README.md": """\
# ForgeMind CLI

`forgemind` creates tasks and follows their runs from a terminal.

    curl -fsSL https://forgemind.example/install.sh | sh
    forgemind login
    forgemind task "Stop retrying past the budget" --repo forgemind/api
""",
    "install.sh": """\
#!/usr/bin/env sh
# Installs the forgemind command for the current user.
set -eu

if ! command -v node >/dev/null 2>&1; then
  echo "forgemind needs Node.js 20 or newer" >&2
  exit 1
fi

major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$major" -lt 20 ]; then
  echo "forgemind needs Node.js 20 or newer; found $(node --version)" >&2
  exit 1
fi

npm install --global @forgemind/cli
echo "installed: $(forgemind --version)"
""",
    "package.json": """\
{
  "name": "@forgemind/cli",
  "version": "0.4.0",
  "type": "module",
  "packageManager": "pnpm@9.12.0",
  "bin": {
    "forgemind": "dist/cli.js"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "picocolors": "^1.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
""",
    "pnpm-lock.yaml": PNPM_LOCK,
    "tsconfig.json": TSCONFIG,
    "src/cli.ts": """\
#!/usr/bin/env node
import { Command } from 'commander';

import { login } from './commands/login.js';
import { createTask, followTask } from './commands/task.js';

const program = new Command('forgemind').version('0.4.0');

program
  .command('login')
  .description('Sign in and remember the session on this machine')
  .action(login);

program
  .command('task <title>')
  .description('Create a task and follow its run')
  .requiredOption('--repo <name>', 'the repository, as owner/name')
  .option('--no-follow', 'return as soon as the task is created')
  .action(async (title: string, options: { repo: string; follow: boolean }) => {
    const id = await createTask(title, options.repo);
    if (options.follow) {
      await followTask(id);
    }
  });

await program.parseAsync();
""",
    "src/commands/login.ts": """\
import { createInterface } from 'node:readline/promises';

import pc from 'picocolors';

import { readConfig, writeConfig } from '../config.js';

export async function login(): Promise<void> {
  const config = await readConfig();
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  console.log(`Open ${pc.cyan(`${config.api}/cli/token`)} and paste the token.`);
  const token = (await prompt.question('Token: ')).trim();
  prompt.close();
  if (!token) {
    throw new Error('No token given');
  }
  await writeConfig({ ...config, token });
  console.log(pc.green('Signed in.'));
}
""",
    "src/commands/task.ts": """\
import pc from 'picocolors';

import { readConfig } from '../config.js';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const config = await readConfig();
  if (!config.token) {
    throw new Error('Not signed in. Run `forgemind login` first.');
  }
  const response = await fetch(`${config.api}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`${path} answered ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function createTask(title: string, repository: string): Promise<string> {
  const task = await call<{ id: string }>('/tasks', {
    method: 'POST',
    body: JSON.stringify({ title, repository }),
  });
  console.log(`Created task ${pc.bold(task.id)}`);
  return task.id;
}

export async function followTask(id: string): Promise<void> {
  let seen = 0;
  for (;;) {
    const task = await call<{ status: string; events: string[] }>(`/tasks/${id}`);
    for (const line of task.events.slice(seen)) {
      console.log(pc.dim(line));
    }
    seen = task.events.length;
    if (task.status !== 'queued' && task.status !== 'running') {
      console.log(`Finished: ${pc.bold(task.status)}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
""",
    "src/config.ts": """\
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface Config {
  api: string;
  token?: string;
}

const DEFAULTS: Config = { api: 'https://api.forgemind.example' };

export function configPath(home: string = homedir()): string {
  return join(home, '.config', 'forgemind', 'config.json');
}

export async function readConfig(path: string = configPath()): Promise<Config> {
  try {
    return { ...DEFAULTS, ...JSON.parse(await readFile(path, 'utf8')) };
  } catch {
    return DEFAULTS;
  }
}

export async function writeConfig(
  config: Config,
  path: string = configPath(),
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // The token is a credential: readable by its owner only.
  await writeFile(path, JSON.stringify(config, null, 2), { mode: 0o600 });
}
""",
    "test/config.test.ts": """\
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readConfig, writeConfig } from '../src/config.js';

describe('config', () => {
  it('falls back to the defaults when there is no file', async () => {
    const config = await readConfig('/nonexistent/config.json');
    expect(config.api).toBe('https://api.forgemind.example');
    expect(config.token).toBeUndefined();
  });

  it('keeps the token readable by its owner only', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'forgemind-')), 'config.json');
    await writeConfig({ api: 'http://localhost:4000', token: 't' }, path);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await readConfig(path)).token).toBe('t');
  });
});
""",
}

NOTES_API = {
    "README.md": """\
# notes-api

A small API for personal notes. Express in front of PostgreSQL.

    npm install
    npm run dev
""",
    "package.json": """\
{
  "name": "notes-api",
  "version": "1.2.0",
  "private": true,
  "main": "dist/index.js",
  "scripts": {
    "dev": "ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "jest"
  },
  "dependencies": {
    "express": "^4.21.0",
    "pg": "^8.13.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.0",
    "ts-node": "^10.9.0",
    "typescript": "^5.6.0"
  }
}
""",
    "package-lock.json": """\
{
  "name": "notes-api",
  "version": "1.2.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {}
}
""",
    "tsconfig.json": TSCONFIG.replace("NodeNext", "CommonJS").replace(
        '"moduleResolution": "CommonJS"', '"moduleResolution": "Node"'
    ),
    "db/schema.sql": """\
CREATE TABLE notes (
  id serial PRIMARY KEY,
  owner text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notes_owner_updated_at ON notes (owner, updated_at DESC);
""",
    "src/index.ts": """\
import express from 'express';

import { authenticate } from './auth';
import { pool } from './db';
import { notes } from './notes';

const app = express();
app.use(express.json({ limit: '100kb' }));
app.get('/health', (_request, response) => response.json({ status: 'ok' }));
app.use('/notes', authenticate, notes(pool));

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`notes-api listening on ${port}`);
});
""",
    "src/auth.ts": """\
import type { NextFunction, Request, Response } from 'express';

const TOKENS = new Map(
  (process.env.API_TOKENS ?? '')
    .split(',')
    .filter(Boolean)
    .map((pair) => pair.split(':') as [string, string]),
);

/** Finds whose token this is and puts their name on the request. */
export function authenticate(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const header = request.header('authorization') ?? '';
  const owner = TOKENS.get(header.replace(/^Bearer /, ''));
  if (!owner) {
    response.status(401).json({ error: 'Not signed in' });
    return;
  }
  response.locals.owner = owner;
  next();
}
""",
    "src/db.ts": """\
import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});
""",
    "src/notes.ts": """\
import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';

const NoteInput = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(20_000).default(''),
});

export function notes(pool: Pool): Router {
  const router = Router();

  router.get('/', async (_request, response) => {
    const { rows } = await pool.query(
      `SELECT id, title, updated_at FROM notes
       WHERE owner = $1 ORDER BY updated_at DESC`,
      [response.locals.owner],
    );
    response.json(rows);
  });

  router.post('/', async (request, response) => {
    const input = NoteInput.safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: 'Invalid note' });
      return;
    }
    const { rows } = await pool.query(
      'INSERT INTO notes (owner, title, body) VALUES ($1, $2, $3) RETURNING id',
      [response.locals.owner, input.data.title, input.data.body],
    );
    response.status(201).json(rows[0]);
  });

  router.delete('/:id', async (request, response) => {
    const result = await pool.query(
      'DELETE FROM notes WHERE id = $1 AND owner = $2',
      [Number(request.params.id), response.locals.owner],
    );
    response.status(result.rowCount ? 204 : 404).end();
  });

  return router;
}
""",
    "test/notes.test.ts": """\
import type { Pool } from 'pg';

import { notes } from '../src/notes';

function poolReturning(rows: unknown[]): Pool {
  const query = jest.fn().mockResolvedValue({ rows, rowCount: rows.length });
  return { query } as never;
}

describe('notes', () => {
  it('mounts the three routes', () => {
    const router = notes(poolReturning([]));
    const paths = router.stack.map((layer) => layer.route?.path);
    expect(paths).toEqual(['/', '/', '/:id']);
  });
});
""",
}

SHOP_WEB = {
    "README.md": """\
# shop-web

The storefront: a product grid and a cart, built with Vite and React.

    npm install
    npm run dev
""",
    "package.json": """\
{
  "name": "shop-web",
  "version": "0.3.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
""",
    "index.html": """\
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Shop</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
""",
    "vite.config.ts": """\
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
""",
    "src/main.tsx": """\
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
""",
    "src/App.tsx": """\
import { useState } from 'react';

import { Cart } from './components/Cart';
import { ProductCard } from './components/ProductCard';
import { add, type Line } from './cart';
import { PRODUCTS } from './products';

export function App() {
  const [lines, setLines] = useState<Line[]>([]);
  return (
    <div className="layout">
      <main className="grid">
        {PRODUCTS.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            onAdd={() => setLines((current) => add(current, product))}
          />
        ))}
      </main>
      <Cart lines={lines} onClear={() => setLines([])} />
    </div>
  );
}
""",
    "src/cart.ts": """\
import type { Product } from './products';

export interface Line {
  product: Product;
  quantity: number;
}

export function add(lines: Line[], product: Product): Line[] {
  const found = lines.find((line) => line.product.id === product.id);
  if (!found) {
    return [...lines, { product, quantity: 1 }];
  }
  return lines.map((line) =>
    line === found ? { ...line, quantity: line.quantity + 1 } : line,
  );
}

/** The total in pence, so no float ever holds money. */
export function total(lines: Line[]): number {
  return lines.reduce((sum, line) => sum + line.product.pence * line.quantity, 0);
}

export function format(pence: number): string {
  return `GBP ${(pence / 100).toFixed(2)}`;
}
""",
    "src/cart.test.ts": """\
import { describe, expect, it } from 'vitest';

import { add, format, total } from './cart';

const mug = { id: 'mug', name: 'Mug', pence: 1250 };

describe('cart', () => {
  it('adds a product once and then counts it', () => {
    const lines = add(add([], mug), mug);
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(2);
    expect(total(lines)).toBe(2500);
  });

  it('formats pence as pounds', () => {
    expect(format(2500)).toBe('GBP 25.00');
  });
});
""",
    "src/products.ts": """\
export interface Product {
  id: string;
  name: string;
  pence: number;
}

export const PRODUCTS: Product[] = [
  { id: 'mug', name: 'Stoneware mug', pence: 1250 },
  { id: 'tote', name: 'Canvas tote', pence: 900 },
  { id: 'notebook', name: 'Dot-grid notebook', pence: 1400 },
  { id: 'pen', name: 'Brass pen', pence: 2800 },
];
""",
    "src/components/Cart.tsx": """\
import { format, total, type Line } from '../cart';

export function Cart({ lines, onClear }: { lines: Line[]; onClear: () => void }) {
  return (
    <aside className="cart" aria-label="Cart">
      <h2>Cart</h2>
      {lines.length === 0 ? (
        <p className="muted">Nothing here yet.</p>
      ) : (
        <ul>
          {lines.map((line) => (
            <li key={line.product.id}>
              {line.quantity} x {line.product.name}
            </li>
          ))}
        </ul>
      )}
      <p className="total">{format(total(lines))}</p>
      <button type="button" onClick={onClear} disabled={lines.length === 0}>
        Clear
      </button>
    </aside>
  );
}
""",
    "src/components/ProductCard.tsx": """\
import { format } from '../cart';
import type { Product } from '../products';

export function ProductCard({
  product,
  onAdd,
}: {
  product: Product;
  onAdd: () => void;
}) {
  return (
    <article className="product">
      <h3>{product.name}</h3>
      <p>{format(product.pence)}</p>
      <button type="button" onClick={onAdd}>
        Add to cart
      </button>
    </article>
  );
}
""",
    "src/styles.css": """\
:root {
  --ink: #1d1b16;
  --paper: #faf7f0;
  --line: #e2dccd;
  --accent: #a6451c;
}

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: Georgia, serif;
}

.layout {
  display: grid;
  grid-template-columns: 1fr 18rem;
  gap: 2rem;
  max-width: 64rem;
  margin: 2rem auto;
  padding: 0 1rem;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
  gap: 1rem;
}

.product,
.cart {
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 1rem;
}

.product button,
.cart button {
  background: var(--accent);
  border: 0;
  border-radius: 4px;
  color: white;
  cursor: pointer;
  padding: 0.5rem 0.75rem;
}

.cart button:disabled {
  opacity: 0.5;
  cursor: default;
}

.muted {
  color: #6f6a5d;
}

.total {
  font-weight: bold;
}
""",
}

DATA_PIPELINE = {
    "README.md": """\
# data-pipeline

Nightly job: pulls yesterday's orders from the shop's API, cleans them and
loads them into the warehouse.

    pip install -r requirements.txt
    make test
    python -m pipeline --date 2026-09-30
""",
    "Makefile": """\
.PHONY: test run

test:
\tpytest -q

run:
\tpython -m pipeline
""",
    "requirements.txt": """\
click==8.1.7
pandas>=2.2
requests>=2.32
sqlalchemy>=2.0
pytest
""",
    "scripts/run_nightly.sh": """\
#!/usr/bin/env sh
# Run from cron at 02:00: loads yesterday's orders.
set -eu
cd "$(dirname "$0")/.."
exec python -m pipeline --date "$(date -d yesterday +%F)"
""",
    "pipeline/__init__.py": """\
\"\"\"Pulls orders, cleans them and loads them into the warehouse.\"\"\"
""",
    "pipeline/__main__.py": """\
\"\"\"`python -m pipeline`: runs one day's load.\"\"\"

import datetime as dt
import logging
import os

import click

from pipeline.extract import fetch_orders
from pipeline.load import load
from pipeline.transform import clean


@click.command()
@click.option("--date", "day", type=click.DateTime(["%Y-%m-%d"]), default=None)
def main(day: dt.datetime | None) -> None:
    logging.basicConfig(level=logging.INFO)
    date = (day or dt.datetime.now() - dt.timedelta(days=1)).date()
    orders = fetch_orders(os.environ["SHOP_API_URL"], date)
    rows = clean(orders)
    written = load(os.environ["WAREHOUSE_URL"], rows)
    logging.info("loaded %d of %d orders for %s", written, len(orders), date)


if __name__ == "__main__":
    main()
""",
    "pipeline/extract.py": """\
\"\"\"Reads one day's orders from the shop's API, page by page.\"\"\"

import datetime as dt
from typing import Any

import requests

PAGE_SIZE = 200


def fetch_orders(api: str, day: dt.date) -> list[dict[str, Any]]:
    orders: list[dict[str, Any]] = []
    page = 1
    while True:
        response = requests.get(
            f"{api}/orders",
            params={"date": day.isoformat(), "page": page, "per_page": PAGE_SIZE},
            timeout=30,
        )
        response.raise_for_status()
        batch = response.json()
        orders.extend(batch)
        if len(batch) < PAGE_SIZE:
            return orders
        page += 1
""",
    "pipeline/transform.py": """\
\"\"\"Turns raw orders into rows the warehouse accepts.\"\"\"

from typing import Any

import pandas as pd

COLUMNS = ["order_id", "customer", "pence", "placed_at"]


def clean(orders: list[dict[str, Any]]) -> pd.DataFrame:
    \"\"\"Drops cancelled and duplicated orders and normalises the rest.\"\"\"
    if not orders:
        return pd.DataFrame(columns=COLUMNS)
    frame = pd.DataFrame(orders)
    frame = frame[frame["status"] != "cancelled"]
    frame = frame.drop_duplicates(subset="id", keep="last")
    return pd.DataFrame(
        {
            "order_id": frame["id"].astype(str),
            "customer": frame["customer_email"].str.strip().str.lower(),
            # Money as whole pence: the API sends pounds as text.
            "pence": (frame["total"].astype(float) * 100).round().astype(int),
            "placed_at": pd.to_datetime(frame["placed_at"], utc=True),
        }
    ).reset_index(drop=True)
""",
    "pipeline/load.py": """\
\"\"\"Writes cleaned orders to the warehouse, replacing the day's rows.\"\"\"

import pandas as pd
from sqlalchemy import create_engine, text


def load(warehouse: str, rows: pd.DataFrame) -> int:
    if rows.empty:
        return 0
    engine = create_engine(warehouse)
    with engine.begin() as connection:
        connection.execute(
            text("DELETE FROM orders WHERE order_id = ANY(:ids)"),
            {"ids": rows["order_id"].tolist()},
        )
        rows.to_sql("orders", connection, if_exists="append", index=False)
    return len(rows)
""",
    "tests/test_transform.py": """\
from pipeline.transform import COLUMNS, clean


def order(**changes: object) -> dict[str, object]:
    return {
        "id": 1,
        "status": "paid",
        "customer_email": " Ada@Example.com ",
        "total": "12.50",
        "placed_at": "2026-09-30T10:00:00Z",
        **changes,
    }


def test_no_orders_is_an_empty_table_with_the_columns() -> None:
    assert list(clean([]).columns) == COLUMNS


def test_cancelled_and_duplicated_orders_are_dropped() -> None:
    rows = clean([order(), order(total="13.00"), order(id=2, status="cancelled")])
    assert rows["order_id"].tolist() == ["1"]
    assert rows["pence"].tolist() == [1300]


def test_emails_are_normalised() -> None:
    assert clean([order()])["customer"].tolist() == ["ada@example.com"]
""",
}

DOTFILES = {
    "README.md": """\
# dotfiles

My shell and editor setup. `./install.sh` links everything into place and
leaves anything already there alone.
""",
    "install.sh": """\
#!/usr/bin/env sh
# Links the files in this repository into the home directory.
set -eu

here=$(cd "$(dirname "$0")" && pwd)

link() {
  target="$HOME/$2"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    echo "skipping $2: something is already there"
    return
  fi
  mkdir -p "$(dirname "$target")"
  ln -sfn "$here/$1" "$target"
  echo "linked $2"
}

link zsh/aliases.zsh .config/zsh/aliases.zsh
link zsh/prompt.zsh .config/zsh/prompt.zsh
link nvim .config/nvim
link bin/git-prune-merged .local/bin/git-prune-merged
""",
    "bin/git-prune-merged": """\
#!/usr/bin/env sh
# Deletes local branches that have been merged into the default branch.
set -eu

default=$(git symbolic-ref --short refs/remotes/origin/HEAD | sed 's|origin/||')
git fetch --prune --quiet
git branch --merged "origin/$default" |
  grep -v -e "^\\*" -e " $default$" |
  xargs -r git branch -d
""",
    "zsh/aliases.zsh": """\
alias g='git'
alias gs='git status --short --branch'
alias gl='git log --oneline --graph --decorate -20'
alias ll='ls -lah'
alias ..='cd ..'
alias ...='cd ../..'

# Make a directory and go into it.
mk() {
  mkdir -p "$1" && cd "$1"
}

# The largest things under the current directory.
big() {
  du -sh -- * 2>/dev/null | sort -rh | head -"${1:-10}"
}
""",
    "zsh/prompt.zsh": """\
autoload -Uz vcs_info
setopt prompt_subst

zstyle ':vcs_info:git:*' formats ' %F{magenta}%b%f'
zstyle ':vcs_info:*' enable git

precmd() {
  vcs_info
}

PROMPT='%F{blue}%~%f${vcs_info_msg_0_} %(?.%F{green}.%F{red})>%f '
""",
    "nvim/init.lua": """\
vim.g.mapleader = ' '

vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.expandtab = true
vim.opt.shiftwidth = 2
vim.opt.tabstop = 2
vim.opt.ignorecase = true
vim.opt.smartcase = true
vim.opt.undofile = true
vim.opt.signcolumn = 'yes'

require('keymaps')
require('plugins')
""",
    "nvim/lua/keymaps.lua": """\
local map = vim.keymap.set

map('n', '<leader>w', '<cmd>write<cr>', { desc = 'Save' })
map('n', '<leader>q', '<cmd>quit<cr>', { desc = 'Quit' })
map('n', '<esc>', '<cmd>nohlsearch<cr>', { desc = 'Clear search' })
map('n', '<leader>e', vim.diagnostic.open_float, { desc = 'Show diagnostic' })
map('v', '<', '<gv', { desc = 'Outdent and keep the selection' })
map('v', '>', '>gv', { desc = 'Indent and keep the selection' })
""",
    "nvim/lua/plugins.lua": """\
local path = vim.fn.stdpath('data') .. '/lazy/lazy.nvim'
if not vim.uv.fs_stat(path) then
  vim.fn.system({
    'git', 'clone', '--filter=blob:none', '--branch=stable',
    'https://github.com/folke/lazy.nvim.git', path,
  })
end
vim.opt.rtp:prepend(path)

require('lazy').setup({
  { 'nvim-treesitter/nvim-treesitter', build = ':TSUpdate' },
  { 'nvim-telescope/telescope.nvim', dependencies = { 'nvim-lua/plenary.nvim' } },
  { 'lewis6991/gitsigns.nvim', opts = {} },
})
""",
}

LEGACY_CMS = {
    "README.md": """\
# legacy-cms

A small page-based CMS. Pages are rows; templates are PHP files.

    composer install
    composer test
    php -S localhost:8000
""",
    "composer.json": """\
{
  "name": "samrivera/legacy-cms",
  "type": "project",
  "require": {
    "php": ">=8.1",
    "ext-pdo": "*",
    "slim/slim": "^4.14"
  },
  "require-dev": {
    "phpunit/phpunit": "^10.5"
  },
  "autoload": {
    "psr-4": { "Cms\\\\": "lib/" }
  },
  "scripts": {
    "test": "phpunit tests"
  }
}
""",
    "composer.lock": """\
{
  "_readme": ["This file locks the dependencies of your project to a known state"],
  "content-hash": "5f3c1a9e7b2d4c6a8e0f1b3d5a7c9e1f",
  "packages": [],
  "packages-dev": []
}
""",
    "index.php": r"""<?php

require __DIR__ . '/vendor/autoload.php';

use Cms\Page;
use Cms\Template;

$pdo = new PDO(getenv('CMS_DSN') ?: 'sqlite:' . __DIR__ . '/cms.sqlite');
$slug = trim(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/') ?: 'home';

$page = Page::find($pdo, $slug);
if ($page === null) {
    http_response_code(404);
    $page = new Page('not-found', 'Not found', 'There is no page here.');
}

echo (new Template(__DIR__ . '/templates/page.php'))->render(['page' => $page]);
""",
    "lib/Page.php": r"""<?php

namespace Cms;

use PDO;

final class Page
{
    public function __construct(
        public readonly string $slug,
        public readonly string $title,
        public readonly string $body,
    ) {
    }

    public static function find(PDO $pdo, string $slug): ?self
    {
        $statement = $pdo->prepare(
            'SELECT slug, title, body FROM pages WHERE slug = ?'
        );
        $statement->execute([$slug]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        return $row ? new self($row['slug'], $row['title'], $row['body']) : null;
    }

    public function save(PDO $pdo): void
    {
        $pdo->prepare(
            'INSERT INTO pages (slug, title, body) VALUES (?, ?, ?)
             ON CONFLICT (slug) DO UPDATE
             SET title = excluded.title, body = excluded.body'
        )->execute([$this->slug, $this->title, $this->body]);
    }

    public static function slugify(string $title): string
    {
        $slug = strtolower(trim(preg_replace('/[^A-Za-z0-9]+/', '-', $title), '-'));
        return $slug === '' ? 'page' : $slug;
    }
}
""",
    "lib/Template.php": r"""<?php

namespace Cms;

final class Template
{
    public function __construct(private readonly string $file)
    {
    }

    public function render(array $values): string
    {
        extract($values, EXTR_SKIP);
        ob_start();
        require $this->file;
        return (string) ob_get_clean();
    }

    public static function e(string $text): string
    {
        return htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
""",
    "templates/page.php": r"""<?php use Cms\Template; ?>
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title><?= Template::e($page->title) ?></title>
  </head>
  <body>
    <h1><?= Template::e($page->title) ?></h1>
    <div class="body"><?= nl2br(Template::e($page->body)) ?></div>
  </body>
</html>
""",
    "admin/login.php": r"""<?php

session_start();

$error = null;
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $hash = getenv('CMS_ADMIN_HASH') ?: '';
    if ($hash !== '' && password_verify($_POST['password'] ?? '', $hash)) {
        session_regenerate_id(true);
        $_SESSION['admin'] = true;
        header('Location: /admin/edit.php');
        exit;
    }
    $error = 'That password is not right.';
}
?>
<!doctype html>
<form method="post">
  <?php if ($error): ?><p role="alert"><?= htmlspecialchars($error) ?></p><?php endif ?>
  <label>Password <input type="password" name="password" required></label>
  <button>Sign in</button>
</form>
""",
    "assets/editor.js": """\
(function () {
  var title = document.querySelector('input[name="title"]');
  var slug = document.querySelector('input[name="slug"]');
  if (!title || !slug) {
    return;
  }
  var touched = slug.value !== '';
  slug.addEventListener('input', function () {
    touched = true;
  });
  title.addEventListener('input', function () {
    if (touched) {
      return;
    }
    slug.value = title.value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  });
})();
""",
    "tests/PageTest.php": r"""<?php

use Cms\Page;
use PHPUnit\Framework\TestCase;

final class PageTest extends TestCase
{
    public function testSlugifyKeepsLettersAndDigits(): void
    {
        $this->assertSame('hello-world-2', Page::slugify(' Hello, World 2! '));
    }

    public function testSlugifyNeverReturnsNothing(): void
    {
        $this->assertSame('page', Page::slugify('!!!'));
    }

    public function testAPageIsFoundAfterItIsSaved(): void
    {
        $pdo = new PDO('sqlite::memory:');
        $pdo->exec('CREATE TABLE pages (slug TEXT PRIMARY KEY, title TEXT, body TEXT)');
        (new Page('about', 'About', 'Hello.'))->save($pdo);
        $this->assertSame('About', Page::find($pdo, 'about')->title);
        $this->assertNull(Page::find($pdo, 'missing'));
    }
}
""",
}

# Each simulated repository's files, by path. A file that starts with `#!`
# is committed executable.
TREES: dict[str, dict[str, str]] = {
    "forgemind/api": FORGEMIND_API,
    "forgemind/web": FORGEMIND_WEB,
    "forgemind/workers": FORGEMIND_WORKERS,
    "acme/payments": ACME_PAYMENTS,
    "acme/legacy-portal": ACME_LEGACY_PORTAL,
    "forgemind/docs": FORGEMIND_DOCS,
    "forgemind/infra": FORGEMIND_INFRA,
    "forgemind/cli": FORGEMIND_CLI,
    "samrivera/notes-api": NOTES_API,
    "samrivera/shop-web": SHOP_WEB,
    "samrivera/data-pipeline": DATA_PIPELINE,
    "samrivera/dotfiles": DOTFILES,
    "samrivera/legacy-cms": LEGACY_CMS,
}


class GitMissing(RuntimeError):
    """There is no git on this machine to commit a repository with."""


def materialise(full_name: str, directory: Path) -> str:
    """Writes the repository `full_name` into `directory`, new or empty, as a
    git repository with one commit on `main`. Returns the commit's hash."""
    tree = TREES[full_name]
    directory.mkdir(parents=True, exist_ok=True)
    for path, content in tree.items():
        target = directory / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8", newline="\n")
        target.chmod(0o755 if content.startswith("#!") else 0o644)
    # Git's own configuration only: nothing of this machine's or this
    # account's can change what is committed.
    environment = {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "HOME": "/nonexistent",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "LC_ALL": "C",
        **IDENTITY,
    }

    def git(*arguments: str) -> str:
        try:
            done = subprocess.run(
                ["git", *arguments],
                cwd=directory,
                env=environment,
                capture_output=True,
                text=True,
                timeout=60,
                check=False,
            )
        except FileNotFoundError:
            raise GitMissing("git is needed to make a simulated repository") from None
        if done.returncode != 0:
            raise RuntimeError(f"git {arguments[0]} failed: {done.stderr.strip()}")
        return done.stdout.strip()

    git("init", "--quiet", "--template=", "--object-format=sha1", "-b", "main", ".")
    git("add", "--all")
    git("commit", "--quiet", "--message", f"Import {full_name}")
    return git("rev-parse", "HEAD")
