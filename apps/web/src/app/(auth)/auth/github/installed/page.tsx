import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AuthCard } from '@/components/auth/auth-card';

import { Installed } from './installed';

export const metadata: Metadata = { title: 'Installing | ForgeMind' };

export default function InstalledPage() {
  return (
    <AuthCard title="Finishing the installation">
      <Suspense>
        <Installed />
      </Suspense>
    </AuthCard>
  );
}
