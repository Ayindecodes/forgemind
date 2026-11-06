'use client';

import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

import {
  ApiRequestError,
  getDataSource,
  request,
  subscribeDataSource,
} from '@/lib/api-client';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        // A refused session will not change on a retry; everything else gets one.
        retry: (failureCount, error) =>
          !(error instanceof ApiRequestError && error.status === 401) &&
          failureCount < 1,
      },
    },
  });
}

export const keys = {
  session: ['session'] as const,
  organization: ['organization'] as const,
  repositories: ['repositories'] as const,
  tasks: ['tasks'] as const,
  notifications: ['notifications'] as const,
  pullRequests: ['pull-requests'] as const,
  usage: ['usage'] as const,
  audit: ['audit'] as const,
  task: (id: string) => ['task', id] as const,
  run: (id: string) => ['run', id] as const,
};

export const useSession = () =>
  useQuery({
    queryKey: keys.session,
    queryFn: ({ signal }) => request('session', { signal }),
  });

export const useOrganization = () =>
  useQuery({
    queryKey: keys.organization,
    queryFn: ({ signal }) => request('organization', { signal }),
  });

export const useRepositories = (
  enabled = true,
  { liveWhileAnalyzing = false } = {},
) =>
  useQuery({
    queryKey: keys.repositories,
    queryFn: ({ signal }) =>
      request('repositories', { query: { limit: 200 }, signal }),
    enabled,
    // Indexing finishes on the API's clock, so keep asking while it runs.
    refetchInterval: liveWhileAnalyzing
      ? (query) =>
          query.state.data?.items.some(({ status }) => status === 'analyzing')
            ? 1000
            : false
      : false,
  });

export const useTasks = (enabled = true, { live = false } = {}) =>
  useQuery({
    queryKey: keys.tasks,
    queryFn: ({ signal }) =>
      request('tasks', { query: { limit: 200 }, signal }),
    enabled,
    // While something runs, the list keeps up with it.
    refetchInterval: live
      ? (query) =>
          query.state.data?.items.some(
            ({ status }) => status === 'running' || status === 'queued',
          )
            ? 5000
            : false
      : false,
  });

/** Every run in the organisation, newest first. */
export const useRuns = (
  filter: { repositoryId?: string; status?: string; outcome?: string } = {},
) =>
  useQuery({
    queryKey: ['runs', filter],
    queryFn: ({ signal }) =>
      request('runs', {
        query: {
          limit: 200,
          ...(filter.repositoryId ? { repositoryId: filter.repositoryId } : {}),
          ...(filter.status
            ? {
                status: filter.status as
                  | 'queued'
                  | 'running'
                  | 'awaiting_approval'
                  | 'completed'
                  | 'cancelled',
              }
            : {}),
          ...(filter.outcome
            ? {
                outcome: filter.outcome as
                  'succeeded' | 'partial' | 'failed' | 'unverified',
              }
            : {}),
        },
        signal,
      }),
  });

export const useUsage = () =>
  useQuery({
    queryKey: keys.usage,
    queryFn: ({ signal }) => request('usage', { signal }),
  });

export const useAudit = (limit = 20) =>
  useQuery({
    queryKey: [...keys.audit, limit],
    queryFn: ({ signal }) => request('audit', { query: { limit }, signal }),
  });

export const useTask = (id: string) =>
  useQuery({
    queryKey: keys.task(id),
    queryFn: ({ signal }) => request('task', { params: { id }, signal }),
  });

/** A run's state as the API last folded it. The live layer takes over from here. */
export const useRun = (id: string | undefined) =>
  useQuery({
    queryKey: keys.run(id ?? ''),
    queryFn: ({ signal }) =>
      request('run', { params: { id: id ?? '' }, signal }),
    enabled: id !== undefined,
  });

export const usePullRequests = (enabled = true) =>
  useQuery({
    queryKey: keys.pullRequests,
    queryFn: ({ signal }) =>
      request('pullRequests', { query: { limit: 200 }, signal }),
    enabled,
  });

export const useNotifications = () =>
  useQuery({
    queryKey: keys.notifications,
    queryFn: ({ signal }) => request('notifications', { signal }),
    refetchInterval: 30_000,
  });

export function useMarkNotificationsRead() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (ids: string[]) =>
      request('markNotificationsRead', { body: { ids } }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.notifications }),
  });
}

export function useSignOut() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: () => request('signOut', {}),
    onSuccess: () => client.clear(),
  });
}

const serverSource = () => 'unknown' as const;

/** Whether the API is serving demo or live data, once a response has arrived. */
export const useDataSource = () =>
  useSyncExternalStore(subscribeDataSource, getDataSource, serverSource);
