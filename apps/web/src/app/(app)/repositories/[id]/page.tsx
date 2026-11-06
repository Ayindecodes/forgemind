import type { Metadata } from 'next';

import { RepositoryDetail } from '@/components/repositories/repository-detail';

export const metadata: Metadata = { title: 'Repository | ForgeMind' };

export default async function RepositoryPage({
  params,
}: PageProps<'/repositories/[id]'>) {
  const { id } = await params;

  return <RepositoryDetail id={id} />;
}
