import { describe, expect, it } from 'vitest';

import {
  formatBytes,
  formatCompact,
  formatCurrency,
  formatDelta,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRelative,
} from './format';

describe('formatNumber', () => {
  it('groups thousands', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
  });
});

describe('formatCompact', () => {
  it('keeps small numbers exact and shortens large ones', () => {
    expect(formatCompact(999)).toBe('999');
    expect(formatCompact(12345)).toBe('12.3K');
    expect(formatCompact(2_500_000)).toBe('2.5M');
  });
});

describe('formatCurrency', () => {
  it('formats dollars with cents', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
  });
});

describe('formatPercent', () => {
  it('formats a ratio', () => {
    expect(formatPercent(0.1234)).toBe('12.3%');
  });
});

describe('formatBytes', () => {
  it('picks the unit and the precision', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(104_857_600)).toBe('100 MB');
    expect(formatBytes(3 * 1024 ** 4)).toBe('3.0 TB');
  });
});

describe('formatDuration', () => {
  it('uses the largest two units that apply', () => {
    expect(formatDuration(320)).toBe('320ms');
    expect(formatDuration(48_000)).toBe('48s');
    expect(formatDuration(83_000)).toBe('1m 23s');
    expect(formatDuration(120_000)).toBe('2m');
    expect(formatDuration(4_320_000)).toBe('1h 12m');
    expect(formatDuration(7_200_000)).toBe('2h');
  });
});

describe('formatDelta', () => {
  it('signs the change with a real minus sign', () => {
    expect(formatDelta(12)).toBe('+12');
    expect(formatDelta(-3)).toBe('−3');
    expect(formatDelta(0)).toBe('0');
    expect(formatDelta(0.125, true)).toBe('+12.5%');
  });
});

describe('formatRelative', () => {
  const now = new Date('2026-11-02T12:00:00Z');

  it('picks the largest unit that fits', () => {
    expect(formatRelative('2026-11-02T11:59:40Z', now)).toBe('just now');
    expect(formatRelative('2026-11-02T11:57:00Z', now)).toBe('3 minutes ago');
    expect(formatRelative('2026-11-02T09:00:00Z', now)).toBe('3 hours ago');
    expect(formatRelative('2026-10-31T12:00:00Z', now)).toBe('2 days ago');
    expect(formatRelative('2026-11-04T12:00:00Z', now)).toBe('in 2 days');
  });
});
