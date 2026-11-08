'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';

import { GitHubMark } from '@/components/brand/github-mark';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/states';
import { request } from '@/lib/api-client';
import { rememberNext, safeNext } from '@/lib/auth';
import { useDataSource, useGitHubProvider } from '@/lib/queries';

export function SignInForm() {
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const source = useDataSource();
  const provider = useGitHubProvider();
  // Nothing has asked the API yet on a direct visit; the health answer's
  // headers say whether the data is demo and whether GitHub is simulated.
  useQuery({
    queryKey: ['health'],
    queryFn: () => request('health', {}),
    staleTime: Infinity,
  });

  const start = useMutation({
    mutationFn: () => request('githubStart', { body: { next } }),
    onSuccess: ({ url }) => {
      rememberNext(next);
      window.location.assign(url);
    },
  });

  if (start.error) {
    return (
      <ErrorState
        title="Could not start sign-in"
        description={start.error.message}
        onRetry={() => start.mutateAsync().then(() => undefined)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Button
        variant="primary"
        icon={<GitHubMark />}
        loading={start.isPending}
        onClick={() => start.mutate()}
        className="h-10 w-full text-md"
        data-testid="sign-in-github"
      >
        Continue with GitHub
      </Button>
      <p className="text-sm text-fg-muted">
        You will be taken to GitHub and back. ForgeMind never sees your GitHub
        password.
      </p>
      {provider === 'simulated' && (
        <p className="flex items-center gap-2 text-sm text-fg-secondary">
          <Badge tone="warning">
            {source === 'demo' ? 'Demo data' : 'Simulated GitHub'}
          </Badge>
          GitHub is simulated here. Pick who to sign in as on the next page.
        </p>
      )}
    </div>
  );
}
