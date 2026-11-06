import type { Metadata } from 'next';

import { HistoryPage } from '@/components/history/history-page';

export const metadata: Metadata = { title: 'Execution History | ForgeMind' };

export default function Page() {
  return <HistoryPage />;
}
