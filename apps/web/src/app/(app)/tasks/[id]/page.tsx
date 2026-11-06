import type { Metadata } from 'next';

import { EmptyState } from '@/components/ui/states';

import { TaskTitle } from './task-title';

export const metadata: Metadata = { title: 'Task | ForgeMind' };

export default async function TaskPage({ params }: PageProps<'/tasks/[id]'>) {
  const { id } = await params;

  return (
    <div className="flex flex-col gap-6">
      <TaskTitle id={id} />
      <div className="material-solid">
        <EmptyState
          title="Not built yet"
          description="The live execution workspace arrives in FE-13. The task above is real, from the API."
        />
      </div>
    </div>
  );
}
