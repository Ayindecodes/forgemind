import type { Metadata } from 'next';

import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/states';

export const metadata: Metadata = { title: 'Usage | ForgeMind' };

export default function UsagePage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Usage"
        description="Tokens, sandbox time, quotas and cost."
      />
      <div className="material-solid">
        <EmptyState
          title="Not built yet"
          description="This page arrives in FE-24. The navigation, data and shell around it are real."
        />
      </div>
    </div>
  );
}
