import type { Metadata } from 'next';
import Link from 'next/link';

import { ForgeMark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Page not found | ForgeMind' };

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
      <ForgeMark size={32} className="text-fg-secondary" />
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="text-fg-secondary">
          This page doesn’t exist, or it has moved.
        </p>
      </div>
      <Button asChild>
        <Link href="/">Back to overview</Link>
      </Button>
    </main>
  );
}
