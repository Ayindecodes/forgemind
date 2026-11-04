import { FolderGit2 } from 'lucide-react';
import type { Metadata } from 'next';

import { PageHeader, PageLayout } from '@/components/shell/page-layout';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: 'Repositories | ForgeMind' };

export default function RepositoriesPage() {
  return (
    <PageLayout>
      <PageHeader
        title="Repositories"
        description="The codebases ForgeMind can read, index and change."
      />
      <EmptyState
        icon={<FolderGit2 />}
        title="No repositories connected"
        description="Connected repositories are indexed first, so ForgeMind understands their structure, history and conventions before it changes anything."
      />
    </PageLayout>
  );
}
