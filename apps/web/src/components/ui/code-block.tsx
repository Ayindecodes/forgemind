import { CopyButton } from '@/components/ui/copy-button';
import { cx } from '@/lib/cx';
import { highlight, type CodeLanguage } from '@/lib/highlight';

type CodeBlockProps = {
  code: string;
  lang?: CodeLanguage;
  /** Shown in the header, such as a file path. Falls back to the language. */
  title?: string;
  lineNumbers?: boolean;
  /** One-based line numbers to emphasise. */
  highlightLines?: readonly number[];
  /** First line number, for excerpts of a larger file. */
  startLine?: number;
  maxHeight?: number;
  className?: string;
};

/** Highlighted on the server, with real text so it can be selected and copied. */
export async function CodeBlock({
  code,
  lang = 'text',
  title,
  lineNumbers = true,
  highlightLines = [],
  startLine = 1,
  maxHeight,
  className,
}: CodeBlockProps) {
  const lines = await highlight(code, lang);
  const marked = new Set(highlightLines);
  const gutter = String(startLine + lines.length - 1).length;

  return (
    <figure className={cx('material-solid overflow-hidden', className)}>
      <figcaption className="flex h-9 items-center justify-between gap-3 border-b border-line pr-1.5 pl-3 text-xs text-fg-secondary">
        <span className="truncate font-mono">{title ?? lang}</span>
        <CopyButton text={code} label="Copy code" />
      </figcaption>
      <pre
        tabIndex={0}
        aria-label={title ? `Code from ${title}` : 'Code'}
        className="overflow-auto p-3 font-mono text-code text-code-foreground outline-none focus-visible:outline-2 focus-visible:outline-focus"
        style={{ maxHeight }}
      >
        <code className="grid">
          {lines.map((tokens, index) => {
            const number = startLine + index;

            return (
              <span
                key={number}
                data-line={number}
                className={cx(
                  'flex',
                  marked.has(number) && '-mx-3 bg-accent-subtle px-3',
                )}
              >
                {lineNumbers && (
                  <span
                    aria-hidden="true"
                    className="shrink-0 pr-4 text-right text-fg-muted select-none"
                    style={{ width: `${gutter + 2}ch` }}
                  >
                    {number}
                  </span>
                )}
                <span className="whitespace-pre">
                  {tokens.map((token, tokenIndex) => (
                    <span key={tokenIndex} style={{ color: token.color }}>
                      {token.content}
                    </span>
                  ))}
                  {tokens.length === 0 && '\n'}
                </span>
              </span>
            );
          })}
        </code>
      </pre>
    </figure>
  );
}
