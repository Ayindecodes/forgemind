'use client';

import type { DiffFile } from '@forgemind/contract';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Decoration,
  Diff,
  getChangeKey,
  Hunk,
  type ChangeData,
  type HunkTokens,
  type TokenNode,
} from 'react-diff-view';

import { Badge } from '@/components/ui/badge';
import { cx } from '@/lib/cx';
import { commentKey, type DraftComment } from '@/lib/review/comments';
import { parseFile } from '@/lib/review/parse';
import { tokensFor } from '@/lib/review/tokens';
import { changeLetter } from '@/lib/review/tree';

import { CommentWidget } from './comment-widget';

export type LineRef = { side: 'old' | 'new'; line: number };
export type ViewType = 'split' | 'unified';

/** Where a change sits: deletions on the old side, everything else on the new. */
export function lineOf(change: ChangeData): LineRef {
  if (change.type === 'delete') return { side: 'old', line: change.lineNumber };
  if (change.type === 'insert') return { side: 'new', line: change.lineNumber };
  return { side: 'new', line: change.newLineNumber };
}

export const anchorId = (path: string, ref: LineRef) =>
  `diff-${path.replace(/[^a-zA-Z0-9]+/g, '-')}-${ref.side}-${ref.line}`;

const renderToken = (
  token: TokenNode,
  renderDefault: (token: TokenNode, index: number) => ReactNode,
  index: number,
) => {
  const style = (token as { properties?: { style?: { color?: string } } })
    .properties?.style;
  const text = (token as { children?: { value?: string }[] }).children
    ?.map((child) => child.value ?? '')
    .join('');
  return style?.color ? (
    <span key={index} style={style}>
      {text}
    </span>
  ) : (
    renderDefault(token, index)
  );
};

export function DiffView({
  file,
  viewType,
  selected,
  comments,
  composer,
  onOpenComposer,
  onCloseComposer,
  onSaveComment,
  onDeleteComment,
}: {
  file: DiffFile;
  viewType: ViewType;
  selected: LineRef | null;
  comments: DraftComment[];
  composer: LineRef | null;
  onOpenComposer: (ref: LineRef) => void;
  onCloseComposer: () => void;
  onSaveComment: (ref: LineRef, text: string) => void;
  onDeleteComment: (id: string) => void;
}) {
  const parsed = useMemo(() => parseFile(file), [file]);
  const [tokens, setTokens] = useState<HunkTokens | null>(null);

  // The parent keys this component by file, so a new file starts without
  // tokens; the request here only ever fills them in.
  useEffect(() => {
    let live = true;
    tokensFor(parsed, file.language).then(
      (result) => live && setTokens(result),
      () => live && setTokens(null),
    );
    return () => {
      live = false;
    };
  }, [parsed, file.language]);

  const changes = useMemo(
    () => parsed.hunks.flatMap((hunk) => hunk.changes),
    [parsed],
  );
  const keyFor = (ref: LineRef) => {
    const change = changes.find((candidate) => {
      const at = lineOf(candidate);
      return at.side === ref.side && at.line === ref.line;
    });
    return change ? getChangeKey(change) : null;
  };

  const selectedChanges = useMemo(() => {
    if (!selected) return [];
    const key = keyFor(selected);
    return key ? [key] : [];
    // keyFor closes over `changes`; `selected` and `parsed` cover it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, parsed]);

  const widgets = useMemo(() => {
    const result: Record<string, ReactNode> = {};
    const lines = new Map<string, { ref: LineRef; comments: DraftComment[] }>();
    for (const comment of comments) {
      if (comment.path !== file.path) continue;
      const ref = { side: comment.side, line: comment.line };
      const key = commentKey(file.path, ref.side, ref.line);
      const entry = lines.get(key) ?? { ref, comments: [] };
      entry.comments.push(comment);
      lines.set(key, entry);
    }
    if (composer) {
      const key = commentKey(file.path, composer.side, composer.line);
      if (!lines.has(key)) lines.set(key, { ref: composer, comments: [] });
    }
    for (const { ref, comments: list } of lines.values()) {
      const key = keyFor(ref);
      if (!key) continue;
      const composing =
        composer?.side === ref.side && composer.line === ref.line;
      result[key] = (
        <CommentWidget
          comments={list}
          composing={composing}
          onSave={(text) => onSaveComment(ref, text)}
          onDelete={onDeleteComment}
          onClose={onCloseComposer}
        />
      );
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments, composer, file.path, parsed]);

  return (
    <section
      data-testid="diff-file"
      data-path={file.path}
      data-view={viewType}
      aria-label={`Diff of ${file.path}`}
      className="material-solid overflow-hidden"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2 text-sm">
        <Badge
          tone={
            file.change === 'added'
              ? 'success'
              : file.change === 'deleted'
                ? 'error'
                : 'neutral'
          }
        >
          {changeLetter[file.change]}
        </Badge>
        <span className="font-mono break-all">
          {file.previousPath && file.previousPath !== file.path && (
            <span className="text-fg-muted">{file.previousPath} → </span>
          )}
          {file.path}
        </span>
        <span className="text-xs tabular-nums">
          <span className="text-success-fg">+{file.additions}</span>{' '}
          <span className="text-error-fg">−{file.deletions}</span>
        </span>
        {file.language && (
          <span className="text-xs text-fg-muted">{file.language}</span>
        )}
      </header>
      {file.explanation && (
        <p className="flex flex-wrap items-baseline gap-2 border-b border-line px-4 py-2 text-sm text-fg-secondary">
          <Badge tone="info">Agent note</Badge>
          <span>{file.explanation}</span>
        </p>
      )}
      <div className={cx('overflow-x-auto', tokens === null && 'opacity-90')}>
        <Diff
          viewType={viewType}
          diffType={parsed.type}
          hunks={parsed.hunks}
          tokens={tokens}
          renderToken={renderToken}
          generateAnchorID={(change) => anchorId(file.path, lineOf(change))}
          selectedChanges={selectedChanges}
          widgets={widgets}
          gutterEvents={{
            onClick: ({ change }) => change && onOpenComposer(lineOf(change)),
          }}
        >
          {(hunks) =>
            hunks.flatMap((hunk) => [
              <Decoration key={`decoration-${hunk.content}`}>
                <span className="font-mono text-xs">{hunk.content}</span>
              </Decoration>,
              <Hunk key={hunk.content} hunk={hunk} />,
            ])
          }
        </Diff>
      </div>
    </section>
  );
}
