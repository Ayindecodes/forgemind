'use client';

import type { Notification } from '@forgemind/contract';
import { Bell } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { SkeletonText } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/states';
import { cx } from '@/lib/cx';
import { formatRelative } from '@/lib/format';
import { useMarkNotificationsRead, useNotifications } from '@/lib/queries';

export function Notifications() {
  const notifications = useNotifications();
  const markRead = useMarkNotificationsRead();
  const items: Notification[] = notifications.data ?? [];
  const unread = items.filter(({ readAt }) => readAt === null);

  return (
    <Popover>
      <span className="relative inline-flex">
        <PopoverTrigger asChild>
          <IconButton
            label={
              unread.length
                ? `Notifications, ${unread.length} unread`
                : 'Notifications'
            }
            variant="ghost"
            icon={<Bell />}
            data-testid="notifications-trigger"
          />
        </PopoverTrigger>
        {unread.length > 0 && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] leading-none font-semibold text-on-accent tabular-nums"
          >
            {unread.length}
          </span>
        )}
      </span>
      <PopoverContent
        align="end"
        className="w-80 p-0"
        data-testid="notifications"
      >
        <div className="flex h-10 items-center justify-between border-b border-line pr-1.5 pl-3">
          <Link
            href="/notifications"
            className="touch-target text-sm font-medium hover:underline"
            data-testid="see-all-notifications"
          >
            Notifications
          </Link>
          <Button
            size="sm"
            variant="ghost"
            disabled={unread.length === 0}
            loading={markRead.isPending}
            onClick={() => markRead.mutate(unread.map(({ id }) => id))}
          >
            Mark all read
          </Button>
        </div>
        {notifications.isPending ? (
          <div className="p-3">
            <SkeletonText lines={3} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="Nothing new"
            description="Approvals, failures and findings land here."
            className="py-6"
          />
        ) : (
          <ul className="max-h-96 overflow-auto py-1">
            {items.map(({ id, title, body, createdAt, readAt }) => (
              <li
                key={id}
                data-testid={`notification-${id}`}
                data-read={readAt !== null}
                className={cx(
                  'flex gap-3 px-3 py-2.5 text-sm',
                  readAt === null && 'bg-accent-subtle/40',
                )}
              >
                <span
                  className={cx(
                    'mt-1.5 size-1.5 shrink-0 rounded-full',
                    readAt === null ? 'bg-accent' : 'bg-transparent',
                  )}
                  aria-hidden="true"
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium">
                    {readAt === null && (
                      <span className="sr-only">Unread: </span>
                    )}
                    {title}
                  </span>
                  {body && <span className="text-fg-secondary">{body}</span>}
                  <span className="text-xs text-fg-muted">
                    {formatRelative(createdAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
