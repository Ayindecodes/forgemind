import type { Finding, Severity } from '@forgemind/contract';

/*
 * The security vocabulary and the list's filters. A finding is either
 * confirmed, with evidence behind it, or a suspicion the tool or agent
 * could not prove. The two never share a list.
 */

export const severityOrder: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export const categoryLabels: Record<Finding['category'], string> = {
  vulnerable_dependency: 'Vulnerable dependency',
  exposed_credential: 'Exposed credential',
  injection: 'Injection',
  deserialization: 'Unsafe deserialization',
  xss: 'Cross-site scripting',
  access_control: 'Access control',
  subprocess: 'Dangerous subprocess',
  configuration: 'Configuration',
  missing_tests: 'Missing tests',
  other: 'Other',
};

export const confidenceLabels: Record<Finding['confidence'], string> = {
  confirmed: 'Confirmed',
  likely: 'Likely, not confirmed',
  suspected: 'Suspected, not confirmed',
};

export const isConfirmed = (finding: Finding) =>
  finding.confidence === 'confirmed';

export type FindingFilters = {
  query?: string;
  severity?: Severity | 'all';
  repositoryId?: string | null;
  showFixed?: boolean;
};

export function filterFindings(
  findings: readonly Finding[],
  {
    query = '',
    severity = 'all',
    repositoryId = null,
    showFixed = false,
  }: FindingFilters,
): Finding[] {
  const needle = query.trim().toLowerCase();
  return findings
    .filter((finding) => showFixed || finding.status === 'open')
    .filter((finding) => severity === 'all' || finding.severity === severity)
    .filter(
      (finding) =>
        repositoryId === null || finding.repositoryId === repositoryId,
    )
    .filter(
      (finding) =>
        needle.length === 0 ||
        finding.title.toLowerCase().includes(needle) ||
        finding.location.path.toLowerCase().includes(needle) ||
        finding.tool.toLowerCase().includes(needle),
    )
    .sort(
      (a, b) =>
        severityOrder[a.severity] - severityOrder[b.severity] ||
        b.detectedAt.localeCompare(a.detectedAt),
    );
}

/** Confirmed findings and suspicions, kept apart. */
export function splitByConfidence(findings: readonly Finding[]) {
  return {
    confirmed: findings.filter(isConfirmed),
    suspicions: findings.filter((finding) => !isConfirmed(finding)),
  };
}

export function countBySeverity(findings: readonly Finding[]) {
  const counts: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}
