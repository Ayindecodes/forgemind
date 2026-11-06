import type { Metadata } from 'next';

import { PullRequestsPage } from '@/components/pull-requests/pull-requests-page';

export const metadata: Metadata = { title: 'Pull Requests | ForgeMind' };

export default function Page() {
  return <PullRequestsPage />;
}
