'use client';

import { BackToOverview, Problem } from '@/components/system/problem';
import { Button } from '@/components/ui/button';

export function OfflineBackHome() {
  return (
    <Problem
      testId="offline-page"
      title="You are offline"
      description="ForgeMind needs a network to show real execution state. Nothing is made up while it waits. Reconnect, then try again."
      actions={
        <>
          <Button
            variant="primary"
            onClick={() => window.location.reload()}
            data-testid="offline-retry"
          >
            Try again
          </Button>
          <BackToOverview />
        </>
      }
    />
  );
}
