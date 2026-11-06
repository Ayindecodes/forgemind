import type { Metadata } from 'next';
import { Suspense } from 'react';

import { RunWorkspace } from '@/components/run/workspace';
import { SkeletonText } from '@/components/ui/skeleton';

import { TaskTitle } from './task-title';

export const metadata: Metadata = { title: 'Task | ForgeMind' };

export default async function TaskPage({ params }: PageProps<'/tasks/[id]'>) {
  const { id } = await params;

  return (
    <div className="flex flex-col gap-6">
      <TaskTitle id={id} />
      <Suspense
        fallback={
          <div className="material-solid p-4" aria-busy="true">
            <SkeletonText lines={6} />
          </div>
        }
      >
        <RunWorkspace taskId={id} />
      </Suspense>
    </div>
  );
}
