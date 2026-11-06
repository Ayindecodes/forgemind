'use client';

import type { DiffFile } from '@forgemind/contract';
import { FolderOpen } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cx } from '@/lib/cx';
import { buildTree, changeLetter, type TreeNode } from '@/lib/review/tree';

/** The changed files, grouped by folder, with the current one marked. */
export function FileTree({
  files,
  selected,
  commentCounts,
  onSelect,
}: {
  files: readonly DiffFile[];
  selected: string | null;
  commentCounts: Record<string, number>;
  onSelect: (path: string) => void;
}) {
  const tree = buildTree(files);
  return (
    <nav aria-label="Changed files" data-testid="file-tree">
      <Branch
        nodes={tree}
        depth={0}
        selected={selected}
        commentCounts={commentCounts}
        onSelect={onSelect}
      />
    </nav>
  );
}

function Branch({
  nodes,
  depth,
  selected,
  commentCounts,
  onSelect,
}: {
  nodes: TreeNode[];
  depth: number;
  selected: string | null;
  commentCounts: Record<string, number>;
  onSelect: (path: string) => void;
}) {
  return (
    <ul className="flex flex-col">
      {nodes.map((node) =>
        node.kind === 'folder' ? (
          <li key={node.path}>
            <details open>
              <summary
                className="flex cursor-pointer items-center gap-1.5 py-1 text-sm text-fg-secondary select-none"
                style={{ paddingLeft: `${depth * 0.75 + 0.5}rem` }}
              >
                <FolderOpen aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="truncate font-mono">{node.name}</span>
              </summary>
              <Branch
                nodes={node.children}
                depth={depth + 1}
                selected={selected}
                commentCounts={commentCounts}
                onSelect={onSelect}
              />
            </details>
          </li>
        ) : (
          <li key={node.path}>
            <button
              type="button"
              data-testid={`file-${node.path}`}
              aria-current={selected === node.path ? 'true' : undefined}
              onClick={() => onSelect(node.path)}
              style={{ paddingLeft: `${depth * 0.75 + 0.5}rem` }}
              className={cx(
                'flex w-full items-center gap-2 py-1 pr-2 text-left text-sm pointer-coarse:py-2',
                selected === node.path
                  ? 'bg-accent-subtle text-fg'
                  : 'text-fg-secondary hover:bg-hover hover:text-fg',
              )}
            >
              <span
                className={cx(
                  'w-4 shrink-0 text-center font-mono text-xs',
                  node.file.change === 'added' && 'text-success-fg',
                  node.file.change === 'deleted' && 'text-error-fg',
                )}
              >
                {changeLetter[node.file.change]}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono">
                {node.name}
              </span>
              {commentCounts[node.path] ? (
                <Badge tone="accent">{commentCounts[node.path]}</Badge>
              ) : null}
              <span className="shrink-0 text-xs tabular-nums">
                <span className="text-success-fg">+{node.file.additions}</span>{' '}
                <span className="text-error-fg">−{node.file.deletions}</span>
              </span>
            </button>
          </li>
        ),
      )}
    </ul>
  );
}
