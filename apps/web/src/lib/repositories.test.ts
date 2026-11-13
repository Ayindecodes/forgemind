import type { Repository } from '@forgemind/contract';
import { describe, expect, it } from 'vitest';

import {
  brokenConnections,
  codeHref,
  filterRepositories,
  shortCommit,
} from './repositories';

const repo = (
  fullName: string,
  status: Repository['status'],
  languages: string[] = [],
): Repository => ({
  id: fullName,
  organizationId: 'org-1',
  githubId: 1,
  fullName,
  defaultBranch: 'main',
  private: false,
  url: `https://github.com/${fullName}`,
  status,
  statusMessage: status === 'error' ? 'Suspended' : null,
  languages: languages.map((name) => ({ name, share: 1 })),
  lastAnalyzedCommit: null,
  lastAnalyzedAt: null,
  openFindings: 0,
  latestTaskId: null,
  pushedAt: '2026-11-06T12:00:00Z',
  connectedAt: '2026-11-06T12:00:00Z',
});

const all = [
  repo('forgemind/web', 'connected', ['TypeScript']),
  repo('acme/payments', 'error', ['Go']),
  repo('acme/legacy', 'revoked'),
  repo('forgemind/api', 'analyzing', ['TypeScript']),
];

describe('filterRepositories', () => {
  it('hides revoked ones by default and puts broken connections first', () => {
    expect(filterRepositories(all, {}).map(({ fullName }) => fullName)).toEqual(
      ['acme/payments', 'forgemind/api', 'forgemind/web'],
    );
  });

  it('narrows by status and by name or language', () => {
    expect(
      filterRepositories(all, { status: 'attention' }).map(({ id }) => id),
    ).toEqual(['acme/payments', 'forgemind/api']);
    expect(
      filterRepositories(all, { status: 'revoked' }).map(({ id }) => id),
    ).toEqual(['acme/legacy']);
    expect(filterRepositories(all, { status: 'all' })).toHaveLength(4);
    expect(
      filterRepositories(all, { query: 'WEB' }).map(({ id }) => id),
    ).toEqual(['forgemind/web']);
    expect(
      filterRepositories(all, { query: 'typescript' }).map(({ id }) => id),
    ).toEqual(['forgemind/api', 'forgemind/web']);
  });

  it('lists what is broken', () => {
    expect(brokenConnections(all).map(({ id }) => id)).toEqual([
      'acme/payments',
    ]);
  });
});

describe('shortCommit', () => {
  it('abbreviates a full hash the way git does and leaves a short one alone', () => {
    expect(shortCommit('3636e5e228b4dd45a11806f46d797e2cb3754854')).toBe(
      '3636e5e',
    );
    expect(shortCommit('a1b2c3d')).toBe('a1b2c3d');
  });
});

describe('codeHref', () => {
  const repository = { url: 'https://github.com/forgemind/web' };
  const commit = '3636e5e228b4dd45a11806f46d797e2cb3754854';

  it('links a file, and a line, at the whole commit', () => {
    expect(codeHref(repository, commit, 'src/server.ts', null)).toBe(
      `https://github.com/forgemind/web/blob/${commit}/src/server.ts`,
    );
    expect(codeHref(repository, commit, 'package.json', 12)).toBe(
      `https://github.com/forgemind/web/blob/${commit}/package.json#L12`,
    );
  });

  it('encodes what a path may hold without touching its separators', () => {
    expect(
      codeHref(repository, commit, 'docs/release notes/v2 #1?.md', 3),
    ).toBe(
      `https://github.com/forgemind/web/blob/${commit}/docs/release%20notes/v2%20%231%3F.md#L3`,
    );
    expect(
      codeHref(repository, commit, 'src/app/(auth)/[id]/page.tsx', null),
    ).toBe(
      `https://github.com/forgemind/web/blob/${commit}/src/app/(auth)/%5Bid%5D/page.tsx`,
    );
  });
});
