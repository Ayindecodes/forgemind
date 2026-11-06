'use client';

import type { Notification } from '@forgemind/contract';
import { useRouter } from 'next/navigation';

import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SkeletonText } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { cx } from '@/lib/cx';
import { formatRelative } from '@/lib/format';
import { kindLabels, orderNotifications } from '@/lib/notifications';
import { useMarkNotificationsRead, useNotifications } from '@/lib/queries';

/* Everything that asked for attention, unread first, each leading somewhere. */

export function NotificationsPage() {
  const router = useRouter();
  const notifications = useNotifications();
  const markRead = useMarkNotificationsRead();
  const items = orderNotifications(notifications.data ?? []);
  const unread = items.filter(({ readAt }) => readAt === null);

  const openItem = async (item: Notification) => {
    if (item.readAt === null) await markRead.mutateAsync([item.id]);
    if (item.href) router.push(item.href);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notifications"
        description={
          unread.length === 0
            ? 'Nothing waits for you.'
            : `${unread.length} unread.`
        }
        actions={
          <Button
            variant="secondary"
            disabled={unread.length === 0}
            loading={markRead.isPending}
            onClick={() => markRead.mutate(unread.map(({ id }) => id))}
            data-testid="mark-all-read"
          >
            Mark all read
          </Button>
        }
      />
      <div
        className="material-solid"
        data-testid="notification-center"
        data-unread={unread.length}
      >
        {notifications.isPending ? (
          <div className="p-4" aria-busy="true">
            <SkeletonText lines={4} />
          </div>
        ) : notifications.error ? (
          <ErrorState
            title="Could not load notifications"
            onRetry={async () => {
              await notifications.refetch();
            }}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="Nothing new"
            description="Approvals, failures and findings land here."
          />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((item) => (
              <li
                key={item.id}
                data-testid={`notification-${item.id}`}
                data-read={item.readAt !== null}
              >
                <button
                  type="button"
                  onClick={() => void openItem(item)}
                  className={cx(
                    'flex w-full items-start gap-3 px-4 py-3 text-left text-sm hover:bg-hover',
                    item.readAt === null && 'bg-accent-subtle/40',
                  )}
                >
                  <span
                    className={cx(
                      'mt-2 size-1.5 shrink-0 rounded-full',
                      item.readAt === null ? 'bg-accent' : 'bg-transparent',
                    )}
                    aria-hidden="true"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge
                        tone={
                          item.kind === 'task_failed'
                            ? 'error'
                            : item.kind === 'task_awaiting_approval'
                              ? 'info'
                              : 'neutral'
                        }
                      >
                        {kindLabels[item.kind]}
                      </Badge>
                      <span className="font-medium">
                        {item.readAt === null && (
                          <span className="sr-only">Unread: </span>
                        )}
                        {item.title}
                      </span>
                    </span>
                    {item.body && (
                      <span className="text-fg-secondary">{item.body}</span>
                    )}
                    <span className="text-xs text-fg-muted">
                      {formatRelative(item.createdAt)}
                      {item.href ? ' · opens the page' : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
