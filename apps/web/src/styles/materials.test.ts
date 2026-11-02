import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { auditContrast } from './contrast';

const srcDir = fileURLToPath(new URL('..', import.meta.url));
const tokens = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

const sourceFiles = readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
  .filter((file) => /\.(css|ts|tsx)$/.test(file))
  .filter((file) => !file.endsWith('.test.ts'))
  .map((file) => join(srcDir, file));

describe('the material system', () => {
  it('is the only place that uses a backdrop filter', () => {
    const offenders = sourceFiles
      .filter((file) => !file.endsWith('materials.css'))
      .filter((file) =>
        /backdrop-(filter|blur|brightness|contrast|saturate)/.test(
          readFileSync(file, 'utf8'),
        ),
      )
      .map((file) => relative(srcDir, file));

    expect(offenders).toEqual([]);
  });

  it('keeps blur tokens out of the Tailwind blur namespace', () => {
    expect(tokens).not.toMatch(/--blur-[a-z0-9]+:\s*\d/);
  });
});

describe('glass tone', () => {
  it('is what keeps text readable over bright backdrops', () => {
    const weakened = tokens.replace(
      /--glass-brightness: [\d.]+;/,
      '--glass-brightness: 1;',
    );

    expect(weakened).not.toBe(tokens);
    expect(
      auditContrast(weakened).some(
        ({ ratio, required, theme, background }) =>
          theme === 'dark' &&
          background === 'backdrop-lightest + glass' &&
          ratio < required,
      ),
    ).toBe(true);
  });
});
