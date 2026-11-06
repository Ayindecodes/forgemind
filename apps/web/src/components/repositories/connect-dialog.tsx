'use client';

import type { GitHubRepository } from '@forgemind/contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { SkeletonText } from '@/components/ui/skeleton';
import { request } from '@/lib/api-client';
import { formatRelative } from '@/lib/format';
import { keys } from '@/lib/queries';
import { toast } from '@/lib/toast';

/** Picks repositories the App can already see, and connects them. */
export function ConnectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useQueryClient();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const available = useQuery({
    queryKey: ['github-repositories'],
    queryFn: ({ signal }) => request('githubRepositories', { signal }),
    enabled: open,
  });
  const candidates = (available.data ?? []).filter(
    (repo) => repo.connectedRepositoryId === null,
  );

  const connect = useMutation({
    mutationFn: async (chosen: GitHubRepository[]) => {
      for (const repo of chosen) {
        await request('connectRepository', {
          body: { githubId: repo.githubId, fullName: repo.fullName },
        });
      }
      return chosen.length;
    },
    onSuccess: async (count) => {
      toast({
        title: `${count} ${count === 1 ? 'repository' : 'repositories'} connected. Indexing has started.`,
        tone: 'success',
      });
      setSelected(new Set());
      onOpenChange(false);
      await Promise.all([
        client.invalidateQueries({ queryKey: keys.repositories }),
        client.invalidateQueries({ queryKey: ['github-repositories'] }),
      ]);
    },
    onError: (error) =>
      toast({
        title: 'Could not connect',
        description: error.message,
        tone: 'error',
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Connect repositories"
        description="These are the repositories the ForgeMind GitHub App can see and that are not connected yet."
      >
        {available.isPending ? (
          <SkeletonText lines={4} />
        ) : available.error ? (
          <p className="text-sm text-error-fg">
            Could not list the repositories on GitHub.
          </p>
        ) : candidates.length === 0 ? (
          <p
            className="text-sm text-fg-secondary"
            data-testid="nothing-to-connect"
          >
            Every repository the App can see is connected. To add more, grant
            the App access to them on GitHub.
          </p>
        ) : (
          <ul className="flex max-h-80 flex-col divide-y divide-line overflow-y-auto rounded-md border border-line">
            {candidates.map((repo) => (
              <li
                key={repo.githubId}
                className="flex items-center gap-3 px-3 py-2"
              >
                <Checkbox
                  label={repo.fullName}
                  description={repo.description ?? undefined}
                  data-testid={`connect-${repo.githubId}`}
                  checked={selected.has(repo.githubId)}
                  onCheckedChange={(checked) =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (checked === true) next.add(repo.githubId);
                      else next.delete(repo.githubId);
                      return next;
                    })
                  }
                />
                <span className="ml-auto text-xs whitespace-nowrap text-fg-muted">
                  pushed {formatRelative(repo.pushedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="primary"
            size="sm"
            disabled={selected.size === 0}
            loading={connect.isPending}
            data-testid="connect-selected"
            onClick={() =>
              connect.mutate(
                candidates.filter((repo) => selected.has(repo.githubId)),
              )
            }
          >
            Connect{selected.size > 0 ? ` ${selected.size}` : ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
