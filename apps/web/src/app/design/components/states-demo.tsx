'use client';

import { GitBranch } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, NoAccessState } from '@/components/ui/states';

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function StatesDemo() {
  const [retries, setRetries] = useState(0);

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="material-solid">
        <EmptyState
          icon={<GitBranch />}
          title="No repositories connected"
          description="Connect a GitHub repository to start analysing it."
          action={<Button variant="primary">Connect repository</Button>}
        />
      </div>
      <div className="material-solid">
        <ErrorState
          title="Analysis failed"
          description="The sandbox ran out of memory while installing dependencies."
          details={
            'MemoryError: container exceeded 2048 MiB\n  at install (sandbox/runner.py:118)'
          }
          onRetry={async () => {
            // Long enough that the busy state is seen, by people and by tests.
            await wait(1500);
            setRetries((count) => count + 1);
          }}
        />
        <p className="sr-only" data-testid="retry-count">
          Retried {retries}
        </p>
      </div>
      <div className="material-solid">
        <NoAccessState
          description="Ask an organization owner for the developer role to run tasks on this repository."
          action={<Button>Request access</Button>}
        />
      </div>
    </div>
  );
}
