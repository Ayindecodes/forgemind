import type { Metadata } from 'next';

import { UsagePage } from '@/components/usage/usage-page';

export const metadata: Metadata = { title: 'Usage | ForgeMind' };

export default function Page() {
  return <UsagePage />;
}
