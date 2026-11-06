import type { Metadata } from 'next';

import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/states';

export const metadata: Metadata = { title: 'Security | ForgeMind' };

export default function SecurityPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Security"
        description="Findings across repositories, with evidence and remediation."
      />
      <div className="material-solid">
        <EmptyState
          title="Not built yet"
          description="This page arrives in FE-21. The navigation, data and shell around it are real."
        />
      </div>
    </div>
  );
}
