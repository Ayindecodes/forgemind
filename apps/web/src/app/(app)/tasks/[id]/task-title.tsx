'use client';

import type { Task } from '@forgemind/contract';

import { PageHeader } from '@/components/shell/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Status, type StatusValue } from '@/components/ui/status';
import { ApiRequestError } from '@/lib/api-client';
import { useTask } from '@/lib/queries';

const statusOf: Record<Task['status'], StatusValue> = {
  queued: 'pending',
  running: 'running',
  awaiting_approval: 'awaiting',
  completed: 'passed',
  failed: 'failed',
  cancelled: 'cancelled',
};

export function TaskTitle({ id }: { id: string }) {
  const task = useTask(id);

  if (task.isPending) return <Skeleton className="h-7 w-72" />;
  if (
    task.error instanceof ApiRequestError &&
    task.error.code === 'not_found'
  ) {
    return (
      <PageHeader
        title="Task not found"
        description={`No task has the id ${id}.`}
      />
    );
  }
  if (!task.data)
    return <PageHeader title="Task" description="Could not load this task." />;

  return (
    <PageHeader
      title={task.data.title}
      description={task.data.request}
      actions={<Status status={statusOf[task.data.status]} />}
    />
  );
}
