import { Event } from '@forgemind/contract';
import { describe, expect, it } from 'vitest';

import {
  applyFilter,
  defaultFilter,
  linesFromEvents,
  linesToText,
  LogBuilder,
} from './log-lines';

let seq = 0;
const ev = (payload: Record<string, unknown>): Event =>
  Event.parse({
    id: `e${++seq}`,
    runId: 'run-1',
    seq,
    at: '2026-11-06T12:00:00.000Z',
    ...payload,
  });

const script: Event[] = [
  ev({ type: 'stage.started', stage: 'testing', attempt: 2, agent: 'testing' }),
  ev({
    type: 'command.started',
    commandId: 'c1',
    command: 'pnpm test',
    cwd: null,
  }),
  ev({
    type: 'command.output',
    commandId: 'c1',
    stream: 'stdout',
    text: 'RUN v5\n✓ a.test.ts\npart',
  }),
  ev({
    type: 'command.output',
    commandId: 'c1',
    stream: 'stdout',
    text: 'ial line\n',
  }),
  ev({
    type: 'command.output',
    commandId: 'c1',
    stream: 'stderr',
    text: 'Warning: slow test\n',
  }),
  ev({
    type: 'command.finished',
    commandId: 'c1',
    exitCode: 1,
    durationMs: 2500,
  }),
  ev({ type: 'log', level: 'error', text: 'Sandbox killed' }),
  ev({
    type: 'agent.note',
    agent: 'testing',
    text: 'The failure is in a.test.ts',
  }),
];

describe('LogBuilder', () => {
  it('turns output into lines and joins a line split across chunks', () => {
    const lines = linesFromEvents(script);

    expect(
      lines.map(({ n, source, text }) => `${n} ${source}: ${text}`),
    ).toEqual([
      '1 system: Testing started (attempt 2), Testing agent',
      '2 command: $ pnpm test',
      '3 stdout: RUN v5',
      '4 stdout: ✓ a.test.ts',
      '5 stdout: partial line',
      '6 stderr: Warning: slow test',
      '7 command: Exited 1 after 3s',
      '8 system: Sandbox killed',
      '9 agent: The failure is in a.test.ts',
    ]);
    expect(lines[6]).toMatchObject({
      level: 'error',
      commandId: 'c1',
      stage: 'testing',
      attempt: 2,
    });
    expect(lines[5]?.level).toBe('warn');
  });

  it('flushes a trailing partial line when the command ends', () => {
    const lines = linesFromEvents([
      ev({
        type: 'command.started',
        commandId: 'c2',
        command: 'echo',
        cwd: null,
      }),
      ev({
        type: 'command.output',
        commandId: 'c2',
        stream: 'stdout',
        text: 'no newline',
      }),
      ev({
        type: 'command.finished',
        commandId: 'c2',
        exitCode: 0,
        durationMs: 10,
      }),
    ]);
    expect(lines.map(({ text }) => text)).toEqual([
      '$ echo',
      'no newline',
      'Exited 0 after 10ms',
    ]);
  });

  it('appends only what is new', () => {
    const builder = new LogBuilder();
    const first = builder.append(script.slice(0, 3));
    expect(first).toHaveLength(4);
    const all = builder.append(script);
    expect(all).toHaveLength(9);
    expect(all).toBe(first);
    expect(builder.append(script)).toHaveLength(9);
  });
});

describe('applyFilter', () => {
  const lines = linesFromEvents(script);

  it('passes everything by default', () => {
    const { visible, matches } = applyFilter(lines, defaultFilter);
    expect(visible).toHaveLength(9);
    expect(matches).toEqual([]);
  });

  it('finds matches without hiding the rest, then hides on request', () => {
    const search = { ...defaultFilter, query: 'TEST' };
    const found = applyFilter(lines, search);
    expect(found.visible).toHaveLength(9);
    expect(found.matches.map((index) => found.visible[index]?.n)).toEqual([
      1, 2, 4, 6, 9,
    ]);

    const only = applyFilter(lines, { ...search, matchesOnly: true });
    expect(only.visible.map(({ n }) => n)).toEqual([1, 2, 4, 6, 9]);
    expect(only.matches).toEqual([0, 1, 2, 3, 4]);
  });

  it('filters by source, level and command', () => {
    expect(
      applyFilter(lines, {
        ...defaultFilter,
        sources: new Set(['stderr']),
      }).visible.map(({ n }) => n),
    ).toEqual([6]);
    expect(
      applyFilter(lines, { ...defaultFilter, level: 'warn' }).visible.map(
        ({ n }) => n,
      ),
    ).toEqual([6, 7, 8]);
    expect(
      applyFilter(lines, { ...defaultFilter, level: 'error' }).visible.map(
        ({ n }) => n,
      ),
    ).toEqual([7, 8]);
    expect(
      applyFilter(lines, { ...defaultFilter, commandId: 'c1' }).visible.map(
        ({ n }) => n,
      ),
    ).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it('copies as plain text', () => {
    expect(linesToText(lines.slice(1, 3))).toBe('$ pnpm test\nRUN v5');
  });
});
