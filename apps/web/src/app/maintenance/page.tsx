import type { Metadata } from 'next';
import Link from 'next/link';

import { Problem } from '@/components/system/problem';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Maintenance | ForgeMind' };

/** Shown while a deployment or a migration keeps the API away. */
export default function MaintenancePage() {
  return (
    <Problem
      testId="maintenance-page"
      title="ForgeMind is being updated"
      description="Runs already in progress carry on; nothing is lost. This usually takes a few minutes."
      actions={
        <Button asChild variant="primary">
          <Link href="/">Try again</Link>
        </Button>
      }
    />
  );
}
