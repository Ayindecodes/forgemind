import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  auditContrast,
  composite,
  contrastRatio,
  parseColor,
  readColorTokens,
  tokenRole,
} from './contrast';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

const describeFailure = ({
  theme,
  token,
  background,
  ratio,
  required,
}: ReturnType<typeof auditContrast>[number]) =>
  `${theme}: ${token} on ${background} is ${ratio.toFixed(2)}, needs ${required}`;

const failures = (source: string) =>
  auditContrast(source)
    .filter(({ ratio, required }) => ratio < required)
    .map(describeFailure);

describe('design tokens', () => {
  it('meet WCAG AA on every background in both themes', () => {
    expect(failures(css)).toEqual([]);
  });

  it('give every color token a contrast role', () => {
    const { dark, light } = readColorTokens(css);
    const names = Object.keys({ ...dark, ...light });

    expect(names.filter((name) => !tokenRole(name))).toEqual([]);
  });

  it('do not reference a color format the audit cannot read', () => {
    const { dark, light } = readColorTokens(css);

    for (const value of [...Object.values(dark), ...Object.values(light)]) {
      expect(() => parseColor(value)).not.toThrow();
    }
  });

  it('define the theme-specific tokens in the light theme', () => {
    const lightBlock = css.slice(css.indexOf(":root[data-theme='light']"));
    const defined = [...lightBlock.matchAll(/--color-([a-z-]+):/g)].map(
      ([, name]) => name,
    );

    expect(defined.sort()).toEqual(
      Object.keys(readColorTokens(css).dark).sort(),
    );
  });
});

describe('auditContrast', () => {
  it('reports a text token that falls below AA', () => {
    const lowered = css.replace(
      /--color-fg-muted: #[0-9a-f]{6};/,
      '--color-fg-muted: #727b88;',
    );

    expect(lowered).not.toBe(css);
    expect(failures(lowered)).toContain(
      'dark: fg-muted on elevated is 4.04, needs 4.5',
    );
  });

  it('covers text on translucent layers', () => {
    const results = auditContrast(css);

    expect(
      results.some(
        ({ token, background }) =>
          token === 'fg-muted' &&
          background === 'backdrop-lightest + glass + pressed',
      ),
    ).toBe(true);
  });
});

describe('contrastRatio', () => {
  it('matches the WCAG reference value for black on white', () => {
    const ratio = contrastRatio(parseColor('#000000'), parseColor('#ffffff'));

    expect(ratio).toBeCloseTo(21);
  });
});

describe('composite', () => {
  it('blends a translucent layer over an opaque base', () => {
    const { r, g, b, a } = composite([
      parseColor('#000000'),
      parseColor('rgb(255 255 255 / 0.5)'),
    ]);

    expect([r, g, b, a]).toEqual([127.5, 127.5, 127.5, 1]);
  });

  it('rejects a translucent base', () => {
    expect(() => composite([parseColor('rgb(0 0 0 / 0.5)')])).toThrow();
  });
});
