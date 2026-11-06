'use client';

import { BackToOverview, Problem } from '@/components/system/problem';
import { Button } from '@/components/ui/button';

/** A page inside the app threw. The shell around it is still fine. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Problem
      testId="app-error"
      title="This page hit an error"
      description="The rest of ForgeMind still works. Trying again usually helps; if it keeps happening, the detail below identifies it."
      detail={error.digest ?? error.message}
      actions={
        <>
          <Button variant="primary" onClick={reset} data-testid="try-again">
            Try again
          </Button>
          <BackToOverview />
        </>
      }
    />
  );
}
