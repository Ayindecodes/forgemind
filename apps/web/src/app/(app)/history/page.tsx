import type { Metadata } from 'next';

import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/states';

export const metadata: Metadata = { title: 'Execution History | ForgeMind' };

export default function HistoryPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Execution History"
        description="Every run, replayable from its recorded events."
      />
      <div className="material-solid">
        <EmptyState
          title="Not built yet"
          description="This page arrives in FE-23. The navigation, data and shell around it are real."
        />
      </div>
    </div>
  );
}
