import type { Report } from '@forgemind/contract';

/** The report as Markdown, section for section, for pasting elsewhere. */
export function reportToMarkdown(report: Report): string {
  const list = (items: readonly string[], empty: string) =>
    items.length === 0
      ? `_${empty}_`
      : items.map((item) => `- ${item}`).join('\n');
  const checks =
    report.checks.length === 0
      ? '_No checks ran._'
      : [
          '| Check | Result | Required |',
          '| --- | --- | --- |',
          ...report.checks.map(
            (check) =>
              `| ${check.label} | ${check.status.replace('_', ' ')}${check.summary ? ` (${check.summary})` : ''} | ${check.required ? 'yes' : 'no'} |`,
          ),
        ].join('\n');
  const findings =
    report.findings.length === 0
      ? '_No findings were raised against this patch._'
      : report.findings
          .map(
            (finding) =>
              `- **${finding.severity}** ${finding.title} (${finding.location.path}${finding.location.line !== null ? `:${finding.location.line}` : ''}, ${finding.tool}). ${finding.evidence || 'No evidence was recorded.'}`,
          )
          .join('\n');

  return [
    `# Engineering report: ${report.repositoryFullName} @ ${report.commit}`,
    '',
    `Run ${report.runId} for task ${report.taskId}. Generated ${report.generatedAt}.`,
    '',
    '## Original task',
    report.task,
    '',
    '## Repository and commit',
    `${report.repositoryFullName} at ${report.commit}`,
    '',
    '## Investigation summary',
    report.investigation,
    '',
    '## Root cause',
    report.rootCause ?? '_Not established._',
    '',
    '## Files modified',
    list(report.filesModified, 'No files were modified.'),
    '',
    '## Changes implemented',
    report.changes,
    '',
    '## Commands executed',
    list(
      report.commands.map((command) => `\`${command}\``),
      'No commands were executed.',
    ),
    '',
    '## Tests and checks',
    checks,
    '',
    '## Security findings',
    findings,
    '',
    '## Unresolved issues',
    list(report.unresolved, 'None recorded.'),
    '',
    '## Final status',
    report.outcome,
    '',
  ].join('\n');
}
