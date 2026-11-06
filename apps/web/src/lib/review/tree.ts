import type { DiffFile } from '@forgemind/contract';

/*
 * The changed files as a tree of folders. Folders with a single child fold
 * into their child, so `src/components/ui` reads as one node, not three.
 */

export type TreeNode =
  | { kind: 'folder'; name: string; path: string; children: TreeNode[] }
  | { kind: 'file'; name: string; path: string; file: DiffFile };

type Draft = {
  folders: Map<string, Draft>;
  files: DiffFile[];
};

export function buildTree(files: readonly DiffFile[]): TreeNode[] {
  const root: Draft = { folders: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split('/');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      let next = node.folders.get(part);
      if (!next) {
        next = { folders: new Map(), files: [] };
        node.folders.set(part, next);
      }
      node = next;
    }
    node.files.push(file);
  }
  return finish(root, '');
}

function finish(draft: Draft, prefix: string): TreeNode[] {
  const folders = [...draft.folders.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, child]): TreeNode => {
      const path = prefix ? `${prefix}/${name}` : name;
      const children = finish(child, path);
      // One folder inside, nothing else: fold the two together.
      const only = children[0];
      if (children.length === 1 && only?.kind === 'folder') {
        return { ...only, name: `${name}/${only.name}` };
      }
      return { kind: 'folder', name, path, children };
    });
  const files = draft.files
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file): TreeNode => ({
      kind: 'file',
      name: file.path.split('/').pop() ?? file.path,
      path: file.path,
      file,
    }));
  return [...folders, ...files];
}

export const changeLetter = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
} as const;
