import type { StatusValue } from '@/components/ui/status';

/*
 * Deterministic demo rows for the design page. The same seed always produces
 * the same rows, so screenshots and tests are stable. Nothing here is real.
 */

export type DemoTask = {
  id: string;
  title: string;
  repository: string;
  status: StatusValue;
  durationMs: number;
  filesChanged: number;
  tokens: number;
  updatedAt: string;
};

const titles = [
  'Investigate the failing build',
  'Fix retry budget overflow',
  'Add tests for the webhook handler',
  'Upgrade vulnerable dependencies',
  'Reduce duplication in the parser',
  'Validate input on the tasks endpoint',
  'Trace the timeout in the sandbox runner',
  'Document the release process',
];

const repositories = [
  'forgemind/api',
  'forgemind/web',
  'forgemind/workers',
  'acme/payments',
  'acme/mobile',
];

const weightedStatuses: StatusValue[] = [
  'passed',
  'passed',
  'passed',
  'failed',
  'running',
  'pending',
  'skipped',
  'awaiting',
  'unverified',
  'partial',
  'cancelled',
  'verified',
];

const DAY = 86_400_000;
const EPOCH = Date.UTC(2026, 10, 1);

/** mulberry32: small, fast and good enough for demo data. */
function random(seed: number) {
  let state = seed;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function demoTasks(count: number, seed = 1): DemoTask[] {
  const next = random(seed);
  const pick = <T>(items: readonly T[]) =>
    items[Math.floor(next() * items.length)] as T;

  return Array.from({ length: count }, (_, index) => ({
    id: `task-${index + 1}`,
    title: `${pick(titles)} #${index + 1}`,
    repository: pick(repositories),
    status: pick(weightedStatuses),
    durationMs: Math.round(next() ** 2 * 3_600_000),
    filesChanged: Math.floor(next() * 40),
    tokens: Math.floor(next() * 250_000),
    updatedAt: new Date(EPOCH - Math.floor(next() * 30 * DAY)).toISOString(),
  }));
}

export const demoCode = `import { retry } from './retry';

/** Runs the checks, revising at most \`budget\` times. */
export async function verify(task: Task, budget = 3): Promise<Outcome> {
  const results = await runChecks(task);

  if (results.every((check) => check.passed)) {
    return { status: 'verified', results };
  }

  if (budget === 0) {
    return { status: 'unverified', results, reason: 'Retry budget exhausted' };
  }

  await retry(task, results);
  return verify(task, budget - 1);
}
`;
