import type { Run } from '@forgemind/contract';

import type { StatusValue } from '@/components/ui/status';

/** The one status that sums a run up, with the outcome once it has finished. */
export function runStatus(run: Run): StatusValue {
  switch (run.status) {
    case 'queued':
      return 'pending';
    case 'running':
      return 'running';
    case 'awaiting_approval':
      return 'awaiting';
    case 'cancelled':
      return 'cancelled';
    case 'completed':
      return run.outcome === 'succeeded'
        ? 'passed'
        : run.outcome === 'partial'
          ? 'partial'
          : run.outcome === 'unverified'
            ? 'unverified'
            : 'failed';
  }
}

export const verificationStatus: Record<Run['verification'], StatusValue> = {
  pending: 'pending',
  verified: 'verified',
  failed: 'failed',
  unverified: 'unverified',
};

export const verificationLabel: Record<Run['verification'], string> = {
  pending: 'Not verified yet',
  verified: 'Verified',
  failed: 'Verification failed',
  unverified: 'Unverified',
};
