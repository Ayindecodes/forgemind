/*
 * Number formatting for metrics and tables. Everything is en-US with tabular
 * output in mind, so columns of values line up.
 */

const number = new Intl.NumberFormat('en-US');
const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});
const percent = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 1,
});

export const formatNumber = (value: number) => number.format(value);

/** 12,345 becomes 12.3K. Below a thousand the number stays exact. */
export const formatCompact = (value: number) =>
  Math.abs(value) < 1000 ? number.format(value) : compact.format(value);

export const formatCurrency = (dollars: number) => currency.format(dollars);

/** 0.123 becomes 12.3%. */
export const formatPercent = (ratio: number) => percent.format(ratio);

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes: number) {
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

/** 83,000 ms becomes "1m 23s". Sub-second values keep their milliseconds. */
export function formatDuration(ms: number) {
  if (ms < 1000) return `${Math.round(ms)}ms`;

  const seconds = Math.round(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;

  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
  return `${rest}s`;
}

/** A signed change, such as "+12.5%" or "−3". */
export function formatDelta(value: number, asPercent = false) {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  const magnitude = asPercent
    ? percent.format(Math.abs(value))
    : formatCompact(Math.abs(value));

  return `${sign}${magnitude}`;
}

const relative = new Intl.RelativeTimeFormat('en-US', { numeric: 'always' });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['week', 7 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "3 minutes ago", "in 2 days", or "just now" inside a minute. */
export function formatRelative(iso: string, now: Date = new Date()) {
  const diff = new Date(iso).getTime() - now.getTime();

  for (const [unit, size] of UNITS) {
    if (Math.abs(diff) >= size)
      return relative.format(Math.round(diff / size), unit);
  }

  return 'just now';
}
