import type { Metadata } from 'next';
import { Suspense } from 'react';

import { PageHeader } from '@/components/shell/page-header';
import { TaskComposer } from '@/components/tasks/task-composer';
import { SkeletonText } from '@/components/ui/skeleton';

export const metadata: Metadata = { title: 'New task | ForgeMind' };

export default function NewTaskPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New task"
        description="Describe what ForgeMind should do, and on which repository."
      />
      <Suspense
        fallback={
          <div className="material-solid p-4" aria-busy="true">
            <SkeletonText lines={6} />
          </div>
        }
      >
        <TaskComposer />
      </Suspense>
    </div>
  );
}
