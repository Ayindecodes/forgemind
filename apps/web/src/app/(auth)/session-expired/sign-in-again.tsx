'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { safeNext, signInHref } from '@/lib/auth';

export function SignInAgain() {
  const next = safeNext(useSearchParams().get('next'));

  return (
    <Button asChild variant="primary" className="h-10 w-full text-md">
      <Link href={signInHref(next)}>Sign in again</Link>
    </Button>
  );
}
