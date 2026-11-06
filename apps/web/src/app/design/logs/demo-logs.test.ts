import { describe, expect, it } from 'vitest';

import { generateLogLines } from './demo-logs';

describe('generateLogLines', () => {
  it('is deterministic and exactly as long as asked', () => {
    const a = generateLogLines(5000);
    const b = generateLogLines(5000);
    expect(a).toHaveLength(5000);
    expect(a.map(({ text }) => text)).toEqual(b.map(({ text }) => text));
    expect(a.at(-1)?.n).toBe(5000);
  });

  it('mixes sources and levels so the filters have something to do', () => {
    const lines = generateLogLines(20_000);
    const sources = new Set(lines.map(({ source }) => source));
    expect([...sources].sort()).toEqual([
      'agent',
      'command',
      'stderr',
      'stdout',
      'system',
    ]);
    expect(lines.some(({ level }) => level === 'error')).toBe(true);
    expect(new Set(lines.map(({ at }) => at)).size).toBeGreaterThan(19_000);
  });
});
