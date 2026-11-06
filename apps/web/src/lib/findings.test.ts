import type { Finding } from '@forgemind/contract';
import { describe, expect, it } from 'vitest';

import { countBySeverity, filterFindings, splitByConfidence } from './findings';

const finding = (
  id: string,
  severity: Finding['severity'],
  confidence: Finding['confidence'],
  status: Finding['status'] = 'open',
  repositoryId = 'repo-1',
): Finding => ({
  id,
  repositoryId,
  runId: null,
  title: `Finding ${id}`,
  severity,
  confidence,
  category: 'other',
  location: { path: `src/${id}.ts`, line: 1 },
  evidence: confidence === 'confirmed' ? 'Seen in the code.' : '',
  remediation: 'Fix it.',
  advisoryUrl: null,
  tool: 'semgrep',
  status,
  detectedAt: `2026-11-0${id.length}T12:00:00Z`,
});

const all = [
  finding('a', 'low', 'confirmed'),
  finding('bb', 'critical', 'suspected'),
  finding('ccc', 'high', 'confirmed', 'fixed'),
  finding('dddd', 'critical', 'confirmed', 'open', 'repo-2'),
  finding('eeeee', 'medium', 'likely'),
];

describe('filterFindings', () => {
  it('hides fixed ones by default and orders by severity, newest first', () => {
    expect(filterFindings(all, {}).map(({ id }) => id)).toEqual([
      'dddd',
      'bb',
      'eeeee',
      'a',
    ]);
    expect(filterFindings(all, { showFixed: true })).toHaveLength(5);
  });

  it('narrows by severity, repository and words', () => {
    expect(
      filterFindings(all, { severity: 'critical' }).map(({ id }) => id),
    ).toEqual(['dddd', 'bb']);
    expect(
      filterFindings(all, { repositoryId: 'repo-2' }).map(({ id }) => id),
    ).toEqual(['dddd']);
    expect(
      filterFindings(all, { query: 'src/bb' }).map(({ id }) => id),
    ).toEqual(['bb']);
  });
});

describe('splitByConfidence', () => {
  it('never lets a suspicion into the confirmed list', () => {
    const { confirmed, suspicions } = splitByConfidence(
      filterFindings(all, {}),
    );
    expect(confirmed.map(({ id }) => id)).toEqual(['dddd', 'a']);
    expect(suspicions.map(({ id }) => id)).toEqual(['bb', 'eeeee']);
    expect(
      suspicions.every((finding) => finding.confidence !== 'confirmed'),
    ).toBe(true);
  });

  it('counts by severity', () => {
    expect(countBySeverity(all)).toEqual({
      critical: 2,
      high: 1,
      medium: 1,
      low: 1,
      info: 0,
    });
  });
});
