/*
 * Review comments drafted in the browser. The API has no comment endpoint;
 * what the reviewer writes travels with their decision, as the instructions
 * of a revision request. Drafts survive a reload through session storage.
 */

export type DraftComment = {
  id: string;
  path: string;
  /** The line the comment sits on, on the new side unless the line was deleted. */
  line: number;
  side: 'old' | 'new';
  text: string;
  createdAt: string;
};

export const commentKey = (path: string, side: 'old' | 'new', line: number) =>
  `${path}:${side}:${line}`;

export function compileComments(comments: readonly DraftComment[]): string {
  if (comments.length === 0) return '';
  const byFile = new Map<string, DraftComment[]>();
  for (const comment of comments) {
    byFile.set(comment.path, [...(byFile.get(comment.path) ?? []), comment]);
  }
  return [...byFile.entries()]
    .map(([path, list]) =>
      [
        `${path}:`,
        ...list
          .slice()
          .sort((a, b) => a.line - b.line)
          .map(
            (comment) =>
              `  line ${comment.line}${comment.side === 'old' ? ' (removed)' : ''}: ${comment.text.trim()}`,
          ),
      ].join('\n'),
    )
    .join('\n\n');
}

const storageKey = (runId: string) => `forgemind:review-comments:${runId}`;

export function loadDrafts(runId: string): DraftComment[] {
  try {
    const raw = window.sessionStorage.getItem(storageKey(runId));
    return raw ? (JSON.parse(raw) as DraftComment[]) : [];
  } catch {
    return [];
  }
}

export function saveDrafts(runId: string, comments: readonly DraftComment[]) {
  try {
    if (comments.length === 0)
      window.sessionStorage.removeItem(storageKey(runId));
    else
      window.sessionStorage.setItem(
        storageKey(runId),
        JSON.stringify(comments),
      );
  } catch {
    // Storage can be blocked; the drafts still live in memory.
  }
}
