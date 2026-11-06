import type { HunkTokens, TokenNode } from 'react-diff-view';

import { isCodeLanguage, type CodeLanguage } from '@/lib/highlight';

import type { FileData } from 'react-diff-view';

/*
 * Syntax tokens for a diff, from the same Shiki highlighter and CSS-variable
 * theme as every code block. react-diff-view reads tokens by absolute line
 * number on each side, so each hunk's old and new text is highlighted
 * separately and placed where its lines live.
 */

type Line = { content: string; color?: string }[];

export const languageOf = (value: string | null): CodeLanguage =>
  value && isCodeLanguage(value) ? value : 'text';

/** Builds the token arrays from already highlighted lines, hunk by hunk. */
export function placeTokens(
  file: FileData,
  highlighted: { old: Line[]; new: Line[] }[],
): HunkTokens {
  const result: HunkTokens = { old: [], new: [] };
  file.hunks.forEach((hunk, index) => {
    const lines = highlighted[index];
    if (!lines) return;
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    let oldIndex = 0;
    let newIndex = 0;
    for (const change of hunk.changes) {
      if (change.type !== 'insert') {
        result.old[oldLine - 1] = toNodes(lines.old[oldIndex] ?? []);
        oldLine += 1;
        oldIndex += 1;
      }
      if (change.type !== 'delete') {
        result.new[newLine - 1] = toNodes(lines.new[newIndex] ?? []);
        newLine += 1;
        newIndex += 1;
      }
    }
  });
  return result;
}

const toNodes = (line: Line): TokenNode[] =>
  line.map((token) => ({
    type: 'element',
    tagName: 'span',
    properties: token.color ? { style: { color: token.color } } : {},
    children: [{ type: 'text', value: token.content }],
  }));

/** The old and new text of a hunk, one line per change on each side. */
export function hunkSides(file: FileData) {
  return file.hunks.map((hunk) => ({
    old: hunk.changes
      .filter((change) => change.type !== 'insert')
      .map((change) => change.content)
      .join('\n'),
    new: hunk.changes
      .filter((change) => change.type !== 'delete')
      .map((change) => change.content)
      .join('\n'),
  }));
}

/** Highlights a parsed file. Loads the highlighter on first use. */
export async function tokensFor(
  file: FileData,
  language: string | null,
): Promise<HunkTokens> {
  const { highlight } = await import('@/lib/highlight');
  const lang = languageOf(language);
  const highlighted = await Promise.all(
    hunkSides(file).map(async (side) => ({
      old: await highlight(side.old, lang),
      new: await highlight(side.new, lang),
    })),
  );
  return placeTokens(file, highlighted);
}
