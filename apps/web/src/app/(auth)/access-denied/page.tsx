import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthCard } from '@/components/auth/auth-card';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Access denied | ForgeMind' };

export default function AccessDeniedPage() {
  return (
    <AuthCard
      title="You don't have access to that"
      description="Your role in this organization does not allow it. An owner or administrator can change your role from Settings."
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button asChild variant="primary">
          <Link href="/">Back to overview</Link>
        </Button>
        <Button asChild>
          <Link href="/settings">Organization settings</Link>
        </Button>
      </div>
    </AuthCard>
  );
}
