import type { Metadata } from 'next';

import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/states';

export const metadata: Metadata = { title: 'Pull Requests | ForgeMind' };

export default function PullRequestsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Pull Requests"
        description="Changes delivered for review, and their status on GitHub."
      />
      <div className="material-solid">
        <EmptyState
          title="Not built yet"
          description="This page arrives in FE-22. The navigation, data and shell around it are real."
        />
      </div>
    </div>
  );
}
