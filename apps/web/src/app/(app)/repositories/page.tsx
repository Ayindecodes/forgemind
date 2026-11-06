import type { Metadata } from 'next';

import { RepositoriesPage } from '@/components/repositories/repositories-page';

export const metadata: Metadata = { title: 'Repositories | ForgeMind' };

export default function Page() {
  return <RepositoriesPage />;
}
