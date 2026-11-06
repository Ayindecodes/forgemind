'use client';

import { X } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Textarea } from '@/components/ui/input';
import type { DraftComment } from '@/lib/review/comments';

/** The comments on one line, and the box to write another. */
export function CommentWidget({
  comments,
  composing,
  onSave,
  onDelete,
  onClose,
}: {
  comments: DraftComment[];
  composing: boolean;
  onSave: (text: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');

  return (
    <div
      data-testid="comment-widget"
      className="flex flex-col gap-2 border-y border-line px-3 py-2 font-sans text-sm"
    >
      {comments.map((comment) => (
        <div
          key={comment.id}
          data-testid="comment"
          className="flex items-start gap-2 rounded-md border border-line bg-surface px-3 py-2"
        >
          <Badge tone="accent">Draft</Badge>
          <p className="min-w-0 flex-1 whitespace-pre-wrap">{comment.text}</p>
          <IconButton
            label="Delete comment"
            icon={<X />}
            size="sm"
            variant="ghost"
            onClick={() => onDelete(comment.id)}
          />
        </div>
      ))}
      {composing && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim().length === 0) return;
            onSave(text.trim());
            setText('');
          }}
        >
          <Textarea
            autoFocus
            aria-label="Comment"
            data-testid="comment-text"
            rows={3}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="What should change here?"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              type="submit"
              disabled={text.trim().length === 0}
              data-testid="save-comment"
            >
              Add comment
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
