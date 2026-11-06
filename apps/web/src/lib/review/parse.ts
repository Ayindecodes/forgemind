import type { DiffFile } from '@forgemind/contract';
import { parseDiff, type FileData } from 'react-diff-view';

/*
 * The API serves each file as a bare unified patch: hunks only, no git
 * header. react-diff-view's parser wants the header, so one is written
 * from what the contract already says about the file.
 */

export function gitHeader(file: DiffFile): string {
  const before = file.previousPath ?? file.path;
  const lines = [`diff --git a/${before} b/${file.path}`];
  if (file.change === 'renamed' && file.previousPath) {
    lines.push(`rename from ${file.previousPath}`, `rename to ${file.path}`);
  }
  if (file.change === 'added') {
    lines.push('new file mode 100644', '--- /dev/null', `+++ b/${file.path}`);
  } else if (file.change === 'deleted') {
    lines.push('deleted file mode 100644', `--- a/${before}`, '+++ /dev/null');
  } else {
    lines.push(`--- a/${before}`, `+++ b/${file.path}`);
  }
  return lines.join('\n') + '\n';
}

export function parseFile(file: DiffFile): FileData {
  const parsed = parseDiff(gitHeader(file) + file.patch)[0];
  if (!parsed) throw new Error(`Could not parse the patch for ${file.path}`);
  return parsed;
}

/** Every new-side line number the patch covers, so a finding can be placed. */
export function newLinesInPatch(parsed: FileData): Set<number> {
  const lines = new Set<number>();
  for (const hunk of parsed.hunks) {
    for (const change of hunk.changes) {
      if (change.type === 'insert') lines.add(change.lineNumber);
      else if (change.type === 'normal') lines.add(change.newLineNumber);
    }
  }
  return lines;
}
