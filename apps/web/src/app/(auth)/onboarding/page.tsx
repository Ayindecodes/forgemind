import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AuthGate } from '@/components/auth/auth-gate';

import { Onboarding } from './onboarding';

export const metadata: Metadata = { title: 'Set up | ForgeMind' };

export default function OnboardingPage() {
  return (
    <AuthGate requireOrganization={false}>
      <Suspense>
        <Onboarding />
      </Suspense>
    </AuthGate>
  );
}
