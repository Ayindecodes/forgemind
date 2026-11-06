'use client';

import { useMutation, useQuery } from '@tanstack/react-query';

import { GitHubMark } from '@/components/brand/github-mark';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SkeletonText } from '@/components/ui/skeleton';
import { request } from '@/lib/api-client';
import { toast } from '@/lib/toast';

/** What ForgeMind may do on GitHub, and on whose account. */
export function InstallationPanel({ canInstall }: { canInstall: boolean }) {
  const installation = useQuery({
    queryKey: ['installation'],
    queryFn: ({ signal }) => request('installation', { signal }),
  });
  const start = useMutation({
    mutationFn: () => request('installStart', {}),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: () =>
      toast({ title: 'Could not start the installation', tone: 'error' }),
  });

  if (installation.isPending) {
    return (
      <div className="material-solid p-4">
        <SkeletonText lines={2} />
      </div>
    );
  }
  const current = installation.data?.installation ?? null;

  return (
    <section
      aria-label="GitHub authorization"
      data-testid="installation"
      data-installed={current !== null}
      className="material-solid flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm"
    >
      <GitHubMark aria-hidden="true" className="size-5 shrink-0" />
      {current ? (
        <>
          <span>
            Installed on{' '}
            <span className="font-mono">{current.accountLogin}</span> (
            {current.accountType}),{' '}
            {current.repositorySelection === 'all'
              ? 'all repositories'
              : 'selected repositories'}
            .
          </span>
          <span className="flex flex-wrap gap-1">
            {current.permissions.map((permission) => (
              <Badge
                key={permission.name}
                tone={permission.access === 'write' ? 'accent' : 'neutral'}
              >
                {permission.name}: {permission.access}
              </Badge>
            ))}
          </span>
          <span className="text-fg-muted">
            Never the default branch, never merges, never deploys.
          </span>
        </>
      ) : (
        <>
          <span className="text-fg-secondary">
            The ForgeMind GitHub App is not installed, so no repository can be
            read.
          </span>
          {canInstall && (
            <Button
              size="sm"
              variant="primary"
              loading={start.isPending}
              onClick={() => start.mutate()}
              data-testid="install-github"
            >
              Install on GitHub
            </Button>
          )}
        </>
      )}
    </section>
  );
}
