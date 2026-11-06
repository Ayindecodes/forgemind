import type { Metadata } from 'next';

import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/states';

export const metadata: Metadata = { title: 'Overview | ForgeMind' };

export default function OverviewPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Overview"
        description="Your repositories, active tasks and what needs review."
      />
      <div className="material-solid">
        <EmptyState
          title="Not built yet"
          description="This page arrives in FE-17. The navigation, data and shell around it are real."
        />
      </div>
    </div>
  );
}
