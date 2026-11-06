import type { Notification } from '@forgemind/contract';

/* Words for notification kinds, and the order the centre shows them in. */

export const kindLabels: Record<Notification['kind'], string> = {
  task_awaiting_approval: 'Needs a decision',
  task_failed: 'Task failed',
  task_completed: 'Task completed',
  finding_detected: 'Finding',
  pull_request_updated: 'Pull request',
  member_joined: 'Member',
};

/** Unread first, then newest first. */
export function orderNotifications(
  items: readonly Notification[],
): Notification[] {
  return [...items].sort(
    (a, b) =>
      Number(a.readAt !== null) - Number(b.readAt !== null) ||
      b.createdAt.localeCompare(a.createdAt),
  );
}
