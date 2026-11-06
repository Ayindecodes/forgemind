import type { Metadata } from 'next';

import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/states';

import { RepositoryTitle } from './repository-title';

export const metadata: Metadata = { title: 'Repository | ForgeMind' };

export default async function RepositoryPage({
  params,
}: PageProps<'/repositories/[id]'>) {
  const { id } = await params;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Repository"
        description={<RepositoryTitle id={id} />}
      />
      <div className="material-solid">
        <EmptyState
          title="Not built yet"
          description="The repository detail arrives in FE-19. The selector in the top bar switches between repositories now."
        />
      </div>
    </div>
  );
}
