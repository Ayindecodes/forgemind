import type { Metadata } from 'next';

import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/states';

export const metadata: Metadata = { title: 'Repositories | ForgeMind' };

export default function RepositoriesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Repositories"
        description="Connected GitHub repositories and their latest analysis."
      />
      <div className="material-solid">
        <EmptyState
          title="Not built yet"
          description="This page arrives in FE-18. The navigation, data and shell around it are real."
        />
      </div>
    </div>
  );
}
