import Link from 'next/link';
import type { ReactNode } from 'react';

import { ForgeMark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';

/*
 * One shape for every page that says something went wrong: what happened,
 * in plain words, and at least one way forward.
 */

export function Problem({
  title,
  description,
  detail,
  actions,
  testId,
}: {
  title: string;
  description: string;
  detail?: string | null;
  actions: ReactNode;
  testId: string;
}) {
  return (
    <main
      className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center"
      data-testid={testId}
    >
      <ForgeMark size={32} className="text-fg-secondary" />
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="max-w-md text-fg-secondary">{description}</p>
        {detail && (
          <p
            className="mt-2 font-mono text-xs break-all text-fg-muted"
            data-testid="problem-detail"
          >
            {detail}
          </p>
        )}
      </div>
      <div className="flex flex-wrap justify-center gap-2">{actions}</div>
    </main>
  );
}

export const BackToOverview = () => (
  <Button asChild variant="secondary">
    <Link href="/">Back to overview</Link>
  </Button>
);
