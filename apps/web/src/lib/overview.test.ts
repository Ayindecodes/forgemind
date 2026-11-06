import type { AuditEvent, Task } from '@forgemind/contract';
import { describe, expect, it } from 'vitest';

import { activeWork, describeAction } from './overview';

const task = (id: string, status: Task['status'], updatedAt: string): Task => ({
  id,
  organizationId: 'org-1',
  repositoryId: 'repo-1',
  title: id,
  request: 'x',
  category: 'fix_bug',
  baseCommit: 'abc',
  branch: null,
  status,
  decision: null,
  runId: `run-${id}`,
  budget: { maxMinutes: 60, maxRetries: 2, maxTokens: 1000 },
  createdBy: 'user-1',
  createdAt: updatedAt,
  updatedAt,
});

describe('activeWork', () => {
  it('puts decisions first, then running, then queued, newest first within each', () => {
    const tasks = [
      task('done', 'completed', '2026-11-06T12:00:00Z'),
      task('queued', 'queued', '2026-11-06T11:00:00Z'),
      task('running-old', 'running', '2026-11-06T09:00:00Z'),
      task('awaiting', 'awaiting_approval', '2026-11-06T08:00:00Z'),
      task('running-new', 'running', '2026-11-06T10:00:00Z'),
      task('failed', 'failed', '2026-11-06T12:00:00Z'),
    ];
    expect(activeWork(tasks).map(({ id }) => id)).toEqual([
      'awaiting',
      'running-new',
      'running-old',
      'queued',
    ]);
    expect(activeWork(tasks, 2)).toHaveLength(2);
  });
});

describe('describeAction', () => {
  const event = (action: string): AuditEvent => ({
    id: 'a',
    actorId: 'u',
    actorName: 'Ayinde',
    action,
    target: { type: 'repository', id: 'r', label: 'forgemind/api' },
    at: '2026-11-06T12:00:00Z',
  });

  it('turns an action code into words', () => {
    expect(describeAction(event('repository.connected'))).toBe(
      'connected a repository',
    );
    expect(describeAction(event('task.approved'))).toBe('approved a task');
    expect(describeAction(event('installation.created'))).toBe(
      'created an installation',
    );
    expect(describeAction(event('member.invited'))).toBe('invited a member');
  });
});
