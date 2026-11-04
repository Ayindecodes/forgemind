import { ListChecks } from 'lucide-react';
import type { Metadata } from 'next';

import { PageHeader, PageLayout } from '@/components/shell/page-layout';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: 'Tasks | ForgeMind' };

export default function TasksPage() {
  return (
    <PageLayout>
      <PageHeader
        title="Tasks"
        description="Autonomous work on your repositories, from plan to pull request."
      />
      <EmptyState
        icon={<ListChecks />}
        title="No tasks yet"
        description="When you start a task, ForgeMind plans the change, works on its own branch, verifies the result and opens a pull request for your review."
      />
    </PageLayout>
  );
}
