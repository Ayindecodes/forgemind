import { statusValues } from '@/components/ui/status';
import { describe, expect, it } from 'vitest';

import { demoTasks } from './demo-data';

describe('demoTasks', () => {
  it('is deterministic for a seed', () => {
    expect(demoTasks(50, 7)).toEqual(demoTasks(50, 7));
    expect(demoTasks(5, 7)).not.toEqual(demoTasks(5, 8));
  });

  it('produces valid rows at scale', () => {
    const rows = demoTasks(10_000);

    expect(rows).toHaveLength(10_000);
    expect(new Set(rows.map(({ id }) => id)).size).toBe(10_000);
    expect(rows.every(({ status }) => statusValues.includes(status))).toBe(
      true,
    );
    expect(rows.every(({ durationMs }) => durationMs >= 0)).toBe(true);
  });
});
