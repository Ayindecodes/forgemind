import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AuthCard } from '@/components/auth/auth-card';

import { SignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in | ForgeMind' };

export default function SignInPage() {
  return (
    <AuthCard
      title="Sign in to ForgeMind"
      description="Signing in reads your GitHub identity and email, nothing else. Access to repositories is a separate step you control."
    >
      <Suspense>
        <SignInForm />
      </Suspense>
    </AuthCard>
  );
}
