import type { Repository } from '@forgemind/contract';
import { describe, expect, it } from 'vitest';

import { brokenConnections, filterRepositories } from './repositories';

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
