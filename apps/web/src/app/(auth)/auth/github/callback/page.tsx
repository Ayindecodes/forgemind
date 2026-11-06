import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AuthCard } from '@/components/auth/auth-card';

import { Callback } from './callback';

export const metadata: Metadata = { title: 'Signing in | ForgeMind' };

export default function CallbackPage() {
  return (
    <AuthCard title="Signing you in">
      <Suspense>
        <Callback />
      </Suspense>
    </AuthCard>
  );
}
