import type { Repository } from '@forgemind/contract';

/*
 * Narrowing the repository list. "Active" is the everyday view: everything
 * still connected, however well. Revoked ones show when asked for.
 */

export type StatusFilter =
  'active' | 'connected' | 'attention' | 'revoked' | 'all';

export const statusFilters: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'connected', label: 'Indexed' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'revoked', label: 'Revoked' },
  { value: 'all', label: 'All' },
];

const matchesStatus = (repo: Repository, filter: StatusFilter) => {
  switch (filter) {
    case 'active':
      return repo.status !== 'revoked';
    case 'connected':
      return repo.status === 'connected';
    case 'attention':
      return repo.status === 'error' || repo.status === 'analyzing';
    case 'revoked':
      return repo.status === 'revoked';
    case 'all':
      return true;
  }
};

export function filterRepositories(
  repositories: readonly Repository[],
  { query = '', status = 'active' }: { query?: string; status?: StatusFilter },
): Repository[] {
  const needle = query.trim().toLowerCase();
  return repositories
    .filter((repo) => matchesStatus(repo, status))
    .filter(
      (repo) =>
        needle.length === 0 ||
        repo.fullName.toLowerCase().includes(needle) ||
        repo.languages.some(({ name }) => name.toLowerCase().includes(needle)),
    )
    .sort((a, b) => {
      // Broken connections first, so they cannot be missed.
      const weight = (repo: Repository) =>
        repo.status === 'error' ? 0 : repo.status === 'analyzing' ? 1 : 2;
      return weight(a) - weight(b) || a.fullName.localeCompare(b.fullName);
    });
}

export const brokenConnections = (repositories: readonly Repository[]) =>
  repositories.filter((repo) => repo.status === 'error');
