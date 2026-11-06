import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AuthCard } from '@/components/auth/auth-card';

import { SignInAgain } from './sign-in-again';

export const metadata: Metadata = { title: 'Session expired | ForgeMind' };

export default function SessionExpiredPage() {
  return (
    <AuthCard
      title="Your session has expired"
      description="Sessions end after seven days, or when an administrator signs you out. Nothing you did was lost."
    >
      <Suspense>
        <SignInAgain />
      </Suspense>
    </AuthCard>
  );
}
