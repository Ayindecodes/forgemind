'use client';

import type { Repository } from '@forgemind/contract';
import { usePathname, useRouter } from 'next/navigation';

import { Select, SelectItem } from '@/components/ui/select';
import { useRepositories } from '@/lib/queries';

/** Shows on repository pages, where switching repository keeps the context. */
export function RepositorySelector() {
  const pathname = usePathname();
  const router = useRouter();
  const repositories = useRepositories();

  const match = /^\/repositories\/([^/]+)/.exec(pathname);
  if (!match) return null;

  const current = match[1] ?? '';
  const all: Repository[] = repositories.data?.items ?? [];
  const items = all.filter(({ status }) => status !== 'revoked');

  return (
    <Select
      value={current}
      onValueChange={(id) => router.push(`/repositories/${id}`)}
      placeholder="Repository"
      className="h-8 w-auto max-w-64"
      aria-label="Repository"
      data-testid="repository-selector"
    >
      {items.map(({ id, fullName }) => (
        <SelectItem key={id} value={id}>
          {fullName}
        </SelectItem>
      ))}
    </Select>
  );
}
