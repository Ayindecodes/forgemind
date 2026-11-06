'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { request } from '@/lib/api-client';
import { takeNext } from '@/lib/auth';
import { keys } from '@/lib/queries';

export function Callback() {
  const params = useSearchParams();
  const router = useRouter();
  const client = useQueryClient();
  const code = params.get('code') ?? '';
  const state = params.get('state') ?? '';

  const finish = useMutation({
    mutationFn: () => request('githubCallback', { body: { code, state } }),
    onSuccess: (session) => {
      client.setQueryData(keys.session, session);
      router.replace(session.organizationId ? takeNext() : '/onboarding');
    },
  });

  const { mutate } = finish;
  useEffect(() => {
    if (code && state) mutate();
  }, [code, state, mutate]);

  if (!code || !state || finish.error) {
    return (
      <ErrorState
        title="Sign-in did not complete"
        description={
          finish.error?.message ?? 'GitHub did not send back what was expected.'
        }
        action={
          <Button variant="primary" onClick={() => router.replace('/sign-in')}>
            Try again
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
      Finishing sign-in with GitHub
    </p>
  );
}
