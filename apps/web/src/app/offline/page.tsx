import type { Metadata } from 'next';

import { OfflineBackHome } from './retry';

export const metadata: Metadata = { title: 'Offline | ForgeMind' };

/** Reached when a cached shell has no network to show anything real with. */
export default function OfflinePage() {
  return <OfflineBackHome />;
}
