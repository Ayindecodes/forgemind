import type { Event, EventType } from '@forgemind/contract';

import { formatDuration } from '@/lib/format';
import { agentLabels, stageLabels } from '@/lib/run-labels';

/*
 * One line per event, in plain words. Events record what really happened;
 * the single AI-authored kind, agent.note, is marked so the UI can set it
 * apart from execution.
 */

export type EventKind = 'execution' | 'note' | 'output' | 'log';

const kinds: Record<EventType, EventKind> = {
  'run.started': 'execution',
  'stage.started': 'execution',
  'stage.finished': 'execution',
  'agent.note': 'note',
  operation: 'execution',
  'file.inspected': 'execution',
  'file.changed': 'execution',
  'command.started': 'execution',
  'command.output': 'output',
  'command.finished': 'execution',
  'check.started': 'execution',
  'check.finished': 'execution',
  'retry.scheduled': 'execution',
  'review.finished': 'execution',
  'resources.sampled': 'execution',
  'approval.requested': 'execution',
  'run.finished': 'execution',
  log: 'log',
};

export const eventKind = (event: Event): EventKind => kinds[event.type];

const changes = {
  added: 'Added',
  modified: 'Changed',
  deleted: 'Deleted',
  renamed: 'Renamed',
} as const;

const verdicts = {
  approve: 'approved',
  request_changes: 'requested changes',
  blocked: 'blocked',
} as const;

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

export function describeEvent(event: Event): string {
  switch (event.type) {
    case 'run.started':
      return `Run started from ${event.baseCommit.slice(0, 7)}${
        event.branch ? ` on ${event.branch}` : ''
      }`;
    case 'stage.started':
      return `${stageLabels[event.stage]} started${
        event.attempt > 1 ? ` (attempt ${event.attempt})` : ''
      }${event.agent ? `, ${agentLabels[event.agent]}` : ''}`;
    case 'stage.finished':
      return `${stageLabels[event.stage]} ${event.status}${
        event.summary ? `: ${event.summary}` : ''
      }${event.failureReason ? `. ${event.failureReason}` : ''}`;
    case 'agent.note':
      return event.text;
    case 'operation':
      return event.text;
    case 'file.inspected':
      return `Inspected ${event.path}`;
    case 'file.changed':
      return `${changes[event.change]} ${event.path} (+${event.additions} −${event.deletions})`;
    case 'command.started':
      return `$ ${event.command}`;
    case 'command.output':
      return event.text;
    case 'command.finished':
      return `Exited ${event.exitCode} after ${formatDuration(event.durationMs)}`;
    case 'check.started':
      return `${event.label} started: ${event.command}`;
    case 'check.finished':
      return `Check ${event.status}${
        event.counts
          ? ` (${event.counts.passed} passed, ${event.counts.failed} failed, ${event.counts.skipped} skipped)`
          : ''
      }${event.summary ? `: ${event.summary}` : ''}`;
    case 'retry.scheduled':
      return `Retry ${event.attempt} scheduled: ${event.reason} (${plural(event.remaining, 'retry')} left)`;
    case 'review.finished':
      return `Review ${verdicts[event.verdict]}${
        event.concerns.length > 0
          ? ` with ${plural(event.concerns.length, 'concern')}`
          : ''
      }${event.acceptanceCriteriaMet ? '' : '. Acceptance criteria not met'}`;
    case 'resources.sampled':
      return `CPU ${Math.round(event.cpuSeconds)}s, memory ${Math.round(event.memoryMb)} MB, sandbox ${Math.round(event.sandboxSeconds)}s`;
    case 'approval.requested':
      return 'Waiting for approval';
    case 'run.finished':
      return `Run ${event.status}${event.error ? `: ${event.error}` : ''}`;
    case 'log':
      return event.text;
  }
}
