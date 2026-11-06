import type { DiffFile, Event, Run } from '@forgemind/contract';
import { initialRun, reduceRun } from '@forgemind/contract';

/*
 * Synthetic but well-formed data for the performance page: a 500-file diff
 * and a run that produces events at a steady rate. Deterministic, so the
 * timings mean the same thing from one run to the next. Nothing is real.
 */

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export function syntheticDiff(count: number, seed = 3): DiffFile[] {
  const next = random(seed);
  return Array.from({ length: count }, (_, index) => {
    const path = `src/module${Math.floor(index / 12)}/file${index}.ts`;
    const lines: string[] = [];
    let oldCount = 0;
    let newCount = 0;
    for (let line = 0; line < 24; line += 1) {
      const roll = next();
      const text = `const value${line} = compute(${Math.floor(next() * 1000)}, '${path}', ${line});`;
      if (roll < 0.6) {
        lines.push(` ${text}`);
        oldCount += 1;
        newCount += 1;
      } else if (roll < 0.8) {
        lines.push(`+${text} // added`);
        newCount += 1;
      } else {
        lines.push(`-${text}`);
        oldCount += 1;
      }
    }
    const additions = lines.filter((line) => line.startsWith('+')).length;
    const deletions = lines.filter((line) => line.startsWith('-')).length;
    return {
      path,
      previousPath: null,
      change: index % 17 === 0 ? 'added' : 'modified',
      additions,
      deletions,
      language: 'typescript',
      patch: `@@ -10,${oldCount} +10,${newCount} @@ function section()\n${lines.join('\n')}\n`,
      explanation:
        index % 5 === 0 ? 'Synthetic change, for timing only.' : null,
    };
  });
}

const stages = [
  'inspection',
  'planning',
  'implementation',
  'testing',
  'review',
  'verification',
] as const;

/** Makes events one at a time, forever, cycling through stages and commands. */
export function eventFactory(runId = 'run-perf') {
  let seq = 0;
  let stage = 0;
  let attempt = 1;
  let phase = 0;
  let command = 0;
  const at = () => new Date(Date.now()).toISOString();
  const base = () => ({ id: `e${seq}`, runId, seq, at: at() });

  const next = (): Event => {
    seq += 1;
    if (seq === 1)
      return {
        ...base(),
        type: 'run.started',
        baseCommit: 'abc1234',
        branch: 'perf',
        expectsPatch: true,
        maxRetries: 2,
      };
    const current = stages[stage % stages.length]!;
    phase += 1;
    switch (phase % 40) {
      case 1:
        return {
          ...base(),
          type: 'stage.started',
          stage: current,
          attempt,
          agent: 'developer',
        };
      case 2:
        return {
          ...base(),
          type: 'operation',
          agent: 'developer',
          text: `Working through ${current}`,
        };
      case 3:
        command += 1;
        return {
          ...base(),
          type: 'command.started',
          commandId: `c${command}`,
          command: `pnpm test --shard=${command}`,
          cwd: null,
        };
      case 36:
        return {
          ...base(),
          type: 'command.finished',
          commandId: `c${command}`,
          exitCode: 0,
          durationMs: 1200,
        };
      case 37:
        return {
          ...base(),
          type: 'file.changed',
          path: `src/file${seq % 50}.ts`,
          change: 'modified',
          additions: 3,
          deletions: 1,
        };
      case 38:
        return {
          ...base(),
          type: 'check.started',
          checkId: `k${command}`,
          kind: 'tests',
          label: `Shard ${command}`,
          command: 'pnpm test',
          required: false,
        };
      case 39:
        return {
          ...base(),
          type: 'check.finished',
          checkId: `k${command}`,
          status: 'passed',
          durationMs: 900,
          summary: '12 passed',
          counts: { passed: 12, failed: 0, skipped: 0 },
        };
      case 0: {
        const finished: Event = {
          ...base(),
          type: 'stage.finished',
          stage: current,
          attempt,
          status: 'passed',
          summary: `${current} done`,
          failureReason: null,
        };
        stage += 1;
        if (stage % stages.length === 0) attempt = Math.min(attempt + 1, 3);
        return finished;
      }
      default:
        return {
          ...base(),
          type: 'command.output',
          commandId: `c${command}`,
          stream: 'stdout',
          text: ` ✓ src/module/file${seq % 90}.test.ts (${seq % 30} tests) ${seq % 900}ms\n`,
        };
    }
  };
  return next;
}

export const foldAll = (events: readonly Event[]): Run =>
  events.reduce(reduceRun, initialRun('run-perf', 'task-perf', 'abc1234'));
