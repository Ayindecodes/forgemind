import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { designNav, isCurrent, primaryNav, secondaryNav } from './navigation';

const app = fileURLToPath(new URL('../app', import.meta.url));
const appRoutes = `${app}/(app)`;

describe('isCurrent', () => {
  it('treats the overview as current only on its own page', () => {
    expect(isCurrent('/', '/')).toBe(true);
    expect(isCurrent('/', '/tasks')).toBe(false);
  });

  it('keeps a section current on its own pages', () => {
    expect(isCurrent('/tasks', '/tasks')).toBe(true);
    expect(isCurrent('/tasks', '/tasks/42')).toBe(true);
  });

  it('does not match a section that only shares a prefix', () => {
    expect(isCurrent('/tasks', '/tasks-archive')).toBe(false);
  });
});

describe('navigation', () => {
  const items = [...primaryNav, ...secondaryNav];

  it('links only to pages that exist in the app shell', () => {
    const missing = items
      .map(({ href }) => `${appRoutes}${href === '/' ? '' : href}/page.tsx`)
      .filter((page) => !existsSync(page));

    expect(missing).toEqual([]);
  });

  it('links the design pages to pages that exist', () => {
    const missing = designNav
      .map(({ href }) => `${app}${href}/page.tsx`)
      .filter((page) => !existsSync(page));

    expect(missing).toEqual([]);
  });

  it('has a unique link and label for every section', () => {
    expect(new Set(items.map(({ href }) => href)).size).toBe(items.length);
    expect(new Set(items.map(({ label }) => label)).size).toBe(items.length);
  });
});
