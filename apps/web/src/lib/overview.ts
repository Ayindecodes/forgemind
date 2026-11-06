import type { AuditEvent, Task } from '@forgemind/contract';

/*
 * What the overview puts first. Work that needs a person comes before work
 * that is running, which comes before work waiting to start. Finished work
 * is history, not the overview.
 */

const rank: Partial<Record<Task['status'], number>> = {
  awaiting_approval: 0,
  running: 1,
  queued: 2,
};

export function activeWork(tasks: readonly Task[], limit = 8): Task[] {
  return tasks
    .filter((task) => task.status in rank)
    .sort(
      (a, b) =>
        (rank[a.status] ?? 9) - (rank[b.status] ?? 9) ||
        b.updatedAt.localeCompare(a.updatedAt),
    )
    .slice(0, limit);
}

/** "repository.connected" becomes "connected a repository". */
export function describeAction(event: AuditEvent): string {
  const [subject = 'something', verb = 'changed'] = event.action.split('.');
  const noun = subject.replace(/_/g, ' ');
  const article = /^[aeiou]/.test(noun) ? 'an' : 'a';
  return `${verb.replace(/_/g, ' ')} ${article} ${noun}`;
}
