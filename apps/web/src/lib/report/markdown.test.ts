import { Report } from '@forgemind/contract';
import { describe, expect, it } from 'vitest';

import { reportToMarkdown } from './markdown';

const report = Report.parse({
  runId: 'run-2',
  taskId: 'task-2',
  repositoryId: 'repo-1',
  repositoryFullName: 'forgemind/api',
  commit: 'c0ffee1',
  task: 'Stop retrying past the budget.',
  investigation: 'The budget resets on every revision.',
  rootCause: null,
  filesModified: ['src/retry.ts'],
  changes: 'Carry the remaining budget across revisions.',
  commands: ['pnpm test'],
  checks: [
    {
      id: 'tests',
      kind: 'tests',
      label: 'Unit tests',
      command: 'pnpm test',
      required: true,
      status: 'passed',
      startedAt: '2026-11-06T12:00:00.000Z',
      finishedAt: '2026-11-06T12:00:04.000Z',
      durationMs: 4000,
      summary: '44 passed',
      counts: { passed: 44, failed: 0, skipped: 0 },
      outputArtifactId: null,
    },
  ],
  findings: [],
  unresolved: [],
  outcome: 'succeeded',
  generatedAt: '2026-11-06T12:19:01.075Z',
});

describe('reportToMarkdown', () => {
  it('writes every section in the order the spec lists them', () => {
    const markdown = reportToMarkdown(report);
    const headings = markdown
      .split('\n')
      .filter((line) => line.startsWith('## '))
      .map((line) => line.slice(3));
    expect(headings).toEqual([
      'Original task',
      'Repository and commit',
      'Investigation summary',
      'Root cause',
      'Files modified',
      'Changes implemented',
      'Commands executed',
      'Tests and checks',
      'Security findings',
      'Unresolved issues',
      'Final status',
    ]);
  });

  it('says plainly what is missing rather than leaving a gap', () => {
    const markdown = reportToMarkdown(report);
    expect(markdown).toContain('## Root cause\n_Not established._');
    expect(markdown).toContain('_No findings were raised against this patch._');
    expect(markdown).toContain('## Unresolved issues\n_None recorded._');
    expect(markdown).toContain('| Unit tests | passed (44 passed) | yes |');
    expect(markdown).toContain('- `pnpm test`');
  });
});
