import type { Metadata } from 'next';

import { RunWorkspace } from '@/components/run/workspace';

import { TaskTitle } from './task-title';

export const metadata: Metadata = { title: 'Task | ForgeMind' };

export default async function TaskPage({ params }: PageProps<'/tasks/[id]'>) {
  const { id } = await params;

  return (
    <div className="flex flex-col gap-6">
      <TaskTitle id={id} />
      <RunWorkspace taskId={id} />
    </div>
  );
}
