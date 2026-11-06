'use client';

import { useQuery } from '@tanstack/react-query';

import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError, request } from '@/lib/api-client';

export function RepositoryTitle({ id }: { id: string }) {
  const repository = useQuery({
    queryKey: ['repository', id],
    queryFn: ({ signal }) => request('repository', { params: { id }, signal }),
  });

  if (repository.isPending) return <Skeleton className="h-4 w-40" />;
  if (
    repository.error instanceof ApiRequestError &&
    repository.error.code === 'not_found'
  ) {
    return <span>No repository with id {id}.</span>;
  }
  if (!repository.data) return <span>Could not load this repository.</span>;

  return (
    <span className="font-mono text-code">{repository.data.fullName}</span>
  );
}
