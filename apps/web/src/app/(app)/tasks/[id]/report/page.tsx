import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ReportView } from '@/components/report/report-view';
import { SkeletonText } from '@/components/ui/skeleton';

import { TaskTitle } from '../task-title';

export const metadata: Metadata = { title: 'Report | ForgeMind' };

export default async function ReportPage({
  params,
}: PageProps<'/tasks/[id]/report'>) {
  const { id } = await params;

  return (
    <div className="flex flex-col gap-6">
      <TaskTitle id={id} />
      <Suspense
        fallback={
          <div className="material-solid p-4" aria-busy="true">
            <SkeletonText lines={8} />
          </div>
        }
      >
        <ReportView taskId={id} />
      </Suspense>
    </div>
  );
}
