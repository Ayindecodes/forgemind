import type { Metadata } from 'next';

import { ReviewWorkspace } from '@/components/review/review-workspace';

import { TaskTitle } from '../task-title';

export const metadata: Metadata = { title: 'Review | ForgeMind' };

export default async function ReviewPage({
  params,
}: PageProps<'/tasks/[id]/review'>) {
  const { id } = await params;

  return (
    <div className="flex flex-col gap-6">
      <TaskTitle id={id} />
      <ReviewWorkspace taskId={id} />
    </div>
  );
}
