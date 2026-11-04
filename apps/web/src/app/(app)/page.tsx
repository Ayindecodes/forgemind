import { ListChecks } from 'lucide-react';
import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ApiStatus, ApiStatusPending } from '@/components/api-status';
import { PageHeader, PageLayout } from '@/components/shell/page-layout';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: 'Overview | ForgeMind' };

export default function OverviewPage() {
  return (
    <PageLayout>
      <PageHeader
        title="Overview"
        description="What ForgeMind is working on across your repositories."
        actions={
          <Suspense fallback={<ApiStatusPending />}>
            <ApiStatus />
          </Suspense>
        }
      />
      <EmptyState
        icon={<ListChecks />}
        title="Nothing running yet"
        description="Tasks you start appear here with their live status, verification results and pull requests."
      />
    </PageLayout>
  );
}
