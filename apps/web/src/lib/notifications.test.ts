import { Notification } from '@forgemind/contract';
import { describe, expect, it } from 'vitest';

import { kindLabels, orderNotifications } from './notifications';

const note = (id: string, createdAt: string, readAt: string | null) =>
  Notification.parse({
    id,
    kind: 'task_failed',
    title: id,
    body: '',
    href: null,
    readAt,
    createdAt,
  });

describe('orderNotifications', () => {
  it('puts unread first, newest first within each', () => {
    const ordered = orderNotifications([
      note('read-new', '2026-11-06T12:00:00Z', '2026-11-06T12:30:00Z'),
      note('unread-old', '2026-11-05T12:00:00Z', null),
      note('unread-new', '2026-11-06T11:00:00Z', null),
      note('read-old', '2026-11-04T12:00:00Z', '2026-11-04T13:00:00Z'),
    ]);
    expect(ordered.map(({ id }) => id)).toEqual([
      'unread-new',
      'unread-old',
      'read-new',
      'read-old',
    ]);
  });

  it('names every kind', () => {
    for (const kind of Notification.shape.kind.options)
      expect(kindLabels[kind].length).toBeGreaterThan(0);
  });
});
