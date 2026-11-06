import { describe, expect, it } from 'vitest';

import { initialRun } from './reduce-run';
import { deriveOutcome, Run } from './runs';
import { deriveVerification, type Check } from './verification';

const check = (
  overrides: Partial<Check> & Pick<Check, 'id' | 'status'>,
): Check => ({
  kind: 'tests',
  label: 'Tests',
  command: 'pnpm test',
  required: true,
  startedAt: null,
  finishedAt: null,
  durationMs: null,
  summary: null,
  counts: null,
  outputArtifactId: null,
  ...overrides,
});

describe('deriveVerification', () => {
  it('is verified only when every required check passed', () => {
    expect(
      deriveVerification(
        [
          check({ id: 'a', status: 'passed' }),
          check({ id: 'b', status: 'passed' }),
        ],
        { finished: true },
      ),
    ).toBe('verified');
  });

  it('is unverified when a required check never ran, even if others passed', () => {
    expect(
      deriveVerification(
        [
          check({ id: 'a', status: 'passed' }),
          check({ id: 'b', status: 'error' }),
        ],
        { finished: true },
      ),
    ).toBe('unverified');
    expect(deriveVerification([], { finished: true })).toBe('unverified');
  });

  it('ignores optional checks', () => {
    expect(
      deriveVerification(
        [
          check({ id: 'a', status: 'passed' }),
          check({ id: 'b', status: 'failed', required: false }),
        ],
        { finished: true },
      ),
    ).toBe('verified');
  });

  it('fails on any failed required check and stays pending while running', () => {
    expect(
      deriveVerification([check({ id: 'a', status: 'failed' })], {
        finished: false,
      }),
    ).toBe('failed');
    expect(
      deriveVerification([check({ id: 'a', status: 'running' })], {
        finished: false,
      }),
    ).toBe('pending');
  });

  it('is never verified before the run has finished', () => {
    expect(
      deriveVerification([check({ id: 'a', status: 'passed' })], {
        finished: false,
      }),
    ).toBe('pending');
  });
});

describe('deriveOutcome', () => {
  const finished = (overrides: Partial<Run>): Run => ({
    ...initialRun('run', 'task', 'abc123'),
    status: 'completed',
    diff: { filesChanged: 2, additions: 10, deletions: 3 },
    ...overrides,
  });

  it('has no outcome while running', () => {
    expect(deriveOutcome(finished({ status: 'running' }))).toBeNull();
  });

  it('succeeds only with a verified patch', () => {
    expect(
      deriveOutcome(
        finished({ checks: [check({ id: 'a', status: 'passed' })] }),
      ),
    ).toBe('succeeded');
  });

  it('is unverified when the patch exists but checks did not run', () => {
    expect(deriveOutcome(finished({}))).toBe('unverified');
    expect(
      deriveOutcome(
        finished({ checks: [check({ id: 'a', status: 'error' })] }),
      ),
    ).toBe('unverified');
  });

  it('is partial when some required checks failed and some passed', () => {
    expect(
      deriveOutcome(
        finished({
          checks: [
            check({ id: 'a', status: 'failed' }),
            check({ id: 'b', status: 'passed', kind: 'build' }),
          ],
        }),
      ),
    ).toBe('partial');
  });

  it('fails when every required check failed or no patch was produced', () => {
    expect(
      deriveOutcome(
        finished({ checks: [check({ id: 'a', status: 'failed' })] }),
      ),
    ).toBe('failed');
    expect(deriveOutcome(finished({ diff: null }))).toBe('failed');
  });

  it('lets an investigation succeed without a patch', () => {
    expect(deriveOutcome(finished({ diff: null, expectsPatch: false }))).toBe(
      'succeeded',
    );
  });
});

describe('Run schema', () => {
  it('rejects a run that claims success without passing checks', () => {
    const claimed = {
      ...initialRun('run', 'task', 'abc123'),
      status: 'completed',
      outcome: 'succeeded',
      verification: 'verified',
      diff: { filesChanged: 1, additions: 1, deletions: 0 },
    };

    const result = Run.safeParse(claimed);

    expect(result.success).toBe(false);
    expect(result.error?.issues.map(({ path }) => path.join('.'))).toEqual(
      expect.arrayContaining(['verification', 'outcome']),
    );
  });

  it('accepts a run whose outcome matches its checks', () => {
    const run = initialRun('run', 'task', 'abc123');

    expect(Run.safeParse(run).success).toBe(true);
  });
});
