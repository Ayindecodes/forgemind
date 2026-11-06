import type { Metadata } from 'next';

import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/states';

export const metadata: Metadata = { title: 'Engineering Tasks | ForgeMind' };

export default function TasksPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Engineering Tasks"
        description="Everything ForgeMind has been asked to do, and how it went."
      />
      <div className="material-solid">
        <EmptyState
          title="Not built yet"
          description="This page arrives in FE-20. The navigation, data and shell around it are real."
        />
      </div>
    </div>
  );
}
