import type { Metadata } from 'next';

import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/states';

export const metadata: Metadata = { title: 'New task | ForgeMind' };

export default function NewTaskPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New task"
        description="Describe what ForgeMind should do, and on which repository."
      />
      <div className="material-solid">
        <EmptyState
          title="Not built yet"
          description="The task composer arrives in FE-20. The shortcut and palette action that brought you here are real."
        />
      </div>
    </div>
  );
}
