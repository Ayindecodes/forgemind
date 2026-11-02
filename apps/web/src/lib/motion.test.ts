import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { durations, easings, movement } from './motion';

const srcDir = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(srcDir, path), 'utf8');

const tokens = read('styles/tokens.css');
const motionCss = read('styles/motion.css');

function token(name: string, css = tokens) {
  const value = new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1];
  if (!value) throw new Error(`Missing ${name}`);

  return value.trim();
}

/** Files allowed to declare timing. Everything else must use the presets. */
const TIMING_SOURCES = [
  'styles/tokens.css',
  'styles/motion.css',
  'lib/motion.ts',
];

const RULES: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\b(?:duration|delay)-(?:\d|\[)/,
    reason: 'a Tailwind duration or delay with a literal value',
  },
  {
    pattern: /\bease-(?:linear|in|out|in-out|\[)/,
    reason: 'a Tailwind easing that is not a token',
  },
  { pattern: /\banimate-\[/, reason: 'an arbitrary animation' },
  { pattern: /@keyframes/, reason: 'keyframes outside the motion system' },
  {
    pattern:
      /\b(?:transition|animation)(?:-duration|-delay)?\s*:[^;{}]*\d+m?s\b/,
    reason: 'a CSS transition or animation with its own timing',
  },
  {
    pattern: /\b(?:duration|delay|repeatDelay)\s*:\s*[\d.]+/,
    reason: 'a Motion transition with its own timing',
  },
  { pattern: /\bease\s*:\s*\[/, reason: 'a Motion easing written inline' },
  {
    pattern: /\btype\s*:\s*['"](?:spring|inertia)['"]|\bbounce\s*:/,
    reason: 'a spring or bounce, which the motion system does not use',
  },
];

export function findTimingViolations(source: string, file: string) {
  return RULES.filter(({ pattern }) => pattern.test(source)).map(
    ({ reason }) => `${file} declares ${reason}`,
  );
}

describe('motion presets', () => {
  it('match the duration tokens', () => {
    for (const [name, seconds] of Object.entries(durations)) {
      expect(token(`--duration-${name}`)).toBe(`${seconds * 1000}ms`);
    }
  });

  it('match the easing tokens', () => {
    for (const [name, curve] of Object.entries(easings)) {
      expect(token(`--ease-${name}`)).toBe(`cubic-bezier(${curve.join(', ')})`);
    }
  });

  it('match the movement amounts in the CSS', () => {
    expect(token('--motion-scale', motionCss)).toBe(String(movement.scale));
    expect(token('--motion-shift', motionCss)).toBe(`${movement.shift}px`);
    expect(token('--motion-press', motionCss)).toBe(String(movement.press));
  });

  it('keep small interactions at 120-180ms and panels at 180-280ms', () => {
    expect(durations.fast * 1000).toBeGreaterThanOrEqual(120);
    expect(durations.base * 1000).toBeLessThanOrEqual(180);
    expect(durations.slow * 1000).toBeGreaterThanOrEqual(180);
    expect(durations.slow * 1000).toBeLessThanOrEqual(280);
  });

  it('use the token durations for every CSS preset', () => {
    const presets = motionCss.slice(motionCss.indexOf('@layer components'));

    expect(presets).not.toMatch(/\d+m?s\b/);
  });
});

describe('the rest of the app', () => {
  it('never declares its own timing', () => {
    const violations = readdirSync(srcDir, {
      recursive: true,
      encoding: 'utf8',
    })
      .filter((file) => /\.(css|ts|tsx)$/.test(file))
      .filter((file) => !/\.test\.tsx?$/.test(file))
      .filter((file) => !TIMING_SOURCES.includes(file))
      .flatMap((file) =>
        findTimingViolations(read(file), relative(srcDir, join(srcDir, file))),
      );

    expect(violations).toEqual([]);
  });
});

describe('findTimingViolations', () => {
  it.each([
    ['className="duration-150"', 'a Tailwind duration or delay'],
    ['className="delay-[40ms]"', 'a Tailwind duration or delay'],
    ['className="ease-in-out"', 'a Tailwind easing'],
    ['className="animate-[wiggle_1s]"', 'an arbitrary animation'],
    ['@keyframes pop { from { opacity: 0 } }', 'keyframes outside'],
    ['.x { transition: opacity 200ms ease; }', 'a CSS transition'],
    ['.x { animation-duration: 1s; }', 'a CSS transition'],
    ['transition={{ duration: 0.3 }}', 'a Motion transition'],
    ['transition={{ ease: [0.4, 0, 1, 1] }}', 'a Motion easing'],
    ["transition={{ type: 'spring', bounce: 0.3 }}", 'a spring or bounce'],
  ])('flags %s', (source, reason) => {
    expect(findTimingViolations(source, 'x.tsx').join()).toContain(reason);
  });

  it('allows the presets and token-driven utilities', () => {
    const source = `
      className="transition-colors duration-fast ease-standard motion-fade-in press"
      transition={transitions.base}
      variants={popover('bottom')}
    `;

    expect(findTimingViolations(source, 'x.tsx')).toEqual([]);
  });
});

