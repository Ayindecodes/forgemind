'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { request } from '@/lib/api-client';

export function Installed() {
  const params = useSearchParams();
  const router = useRouter();
  const client = useQueryClient();
  const installationId = params.get('installation_id') ?? '';
  const state = params.get('state') ?? '';

  const finish = useMutation({
    mutationFn: () =>
      request('installCallback', { body: { installationId, state } }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['installation'] });
      router.replace('/onboarding');
    },
  });

  // The state works once; development's strict mode runs effects twice.
  const exchanged = useRef(false);
  const { mutate } = finish;
  useEffect(() => {
    if (!installationId || !state || exchanged.current) return;
    exchanged.current = true;
    mutate();
  }, [installationId, state, mutate]);

  if (!installationId || !state || finish.error) {
    return (
      <ErrorState
        title="The installation did not complete"
        description={
          finish.error?.message ?? 'GitHub did not send back what was expected.'
        }
        action={
          <Button
            variant="primary"
            onClick={() => router.replace('/onboarding')}
          >
            Back to setup
          </Button>
        }
      />
    );
  }

  return (
    <p
      className="flex items-center gap-2 text-sm text-fg-secondary"
      role="status"
    >
      <Spinner label="" />
      Recording the installation
    </p>
  );
}
