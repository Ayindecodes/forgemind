import type { LogLine, LogSource } from '@/lib/logs/log-lines';

/*
 * A deterministic, realistic-looking log for the design page: the same
 * seed always produces the same lines, so measurements are repeatable.
 * Nothing here is real output.
 */

const files = [
  'src/retry.ts',
  'src/tasks/run.ts',
  'src/plan/cache.ts',
  'src/webhooks/handler.ts',
  'tests/retry.test.ts',
  'tests/webhooks.test.ts',
  'src/sandbox/runner.ts',
  'src/github/client.ts',
];

const warnings = [
  'warning: unused variable `budget`',
  'warning: the sandbox took 4.2s to start',
  'warning: deprecated option `retries`, use `maxRetries`',
];

const errors = [
  'Error: expected 1 to be 0',
  'TypeError: Cannot read properties of undefined (reading "budget")',
  'Error: ENOMEM: container exceeded 2048 MiB',
];

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const pick = <T>(list: readonly T[], roll: number) =>
  list[Math.floor(roll * list.length)] as T;

export function generateLogLines(count: number, seed = 7): LogLine[] {
  const next = random(seed);
  const lines: LogLine[] = [];
  const start = Date.parse('2026-11-06T09:00:00Z');
  let time = start;
  let commandId: string | null = null;
  let commands = 0;

  const push = (source: LogSource, level: LogLine['level'], text: string) => {
    time += 20 + Math.floor(next() * 400);
    lines.push({
      n: lines.length + 1,
      at: new Date(time).toISOString(),
      seq: lines.length + 1,
      source,
      level,
      text,
      commandId,
      stage: 'testing',
      attempt: 1,
    });
  };

  while (lines.length < count) {
    if (lines.length % 2500 === 0) {
      commands += 1;
      commandId = `cmd-${commands}`;
      push('system', 'info', `Testing started (attempt 1), Testing agent`);
      push('command', 'info', `$ pnpm test -- --shard=${commands}/40`);
      push('stdout', 'info', ` RUN  v5.0.5 /workspace/forgemind`);
      continue;
    }
    const roll = next();
    if (roll < 0.74) {
      const file = pick(files, next());
      const tests = 3 + Math.floor(next() * 40);
      const ms = 20 + Math.floor(next() * 900);
      push('stdout', 'info', ` ✓ ${file} (${tests} tests) ${ms}ms`);
    } else if (roll < 0.86) {
      push(
        'stdout',
        'info',
        `   › ${pick(files, next())}:${1 + Math.floor(next() * 300)}:${1 + Math.floor(next() * 80)}`,
      );
    } else if (roll < 0.95) {
      push('stderr', 'warn', pick(warnings, next()));
    } else if (roll < 0.985) {
      const error = pick(errors, next());
      push('stderr', 'error', ` ✗ ${pick(files, next())} > ${error}`);
      push(
        'stderr',
        'error',
        `    at ${pick(files, next())}:${1 + Math.floor(next() * 300)}`,
      );
    } else {
      push('agent', 'info', 'Watching for the failing assertion in the output');
    }
  }

  return lines.slice(0, count);
}
