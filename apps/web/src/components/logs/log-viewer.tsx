'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDownToLine, ChevronDown, ChevronUp, Search } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/checkbox';
import { CopyButton } from '@/components/ui/copy-button';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Select, SelectItem } from '@/components/ui/select';
import { cx } from '@/lib/cx';
import {
  applyFilter,
  defaultFilter,
  linesToText,
  logSources,
  matchesQuery,
  type LogFilter,
  type LogLine,
  type LogSource,
} from '@/lib/logs/log-lines';

/*
 * A log that stays fast at a hundred thousand lines: only the rows in view
 * exist, lines never wrap, and search runs over the data rather than the
 * DOM. Follow mode keeps the newest line in view until the reader scrolls
 * up to look at something; End or the Follow button picks it up again.
 */

const ROW = 22;
const sourceLabels: Record<LogSource, string> = {
  stdout: 'stdout',
  stderr: 'stderr',
  command: 'commands',
  system: 'system',
  agent: 'agents',
};

const lineHash = (n: number) => `#L${n}`;
const lineFromHash = (hash: string) => {
  const match = /^#L(\d+)$/.exec(hash);
  return match ? Number(match[1]) : null;
};

export type LogViewerProps = {
  lines: readonly LogLine[];
  /** The command filter, when the parent owns it. */
  commandId?: string | null;
  onCommandIdChange?: (commandId: string | null) => void;
  className?: string;
  testId?: string;
};

export function LogViewer({
  lines,
  commandId: controlledCommand,
  onCommandIdChange,
  className,
  testId = 'log-viewer',
}: LogViewerProps) {
  const [filter, setFilter] = useState<LogFilter>(defaultFilter);
  const [follow, setFollow] = useState(true);
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastTop = useRef(0);
  // Mirrors `follow` for the scroll handler and effects, which must agree
  // within the same frame rather than a render later.
  const following = useRef(true);
  // Scrolls this component started, which must not count as the reader's.
  const programmatic = useRef(0);

  const effective = useMemo(
    () =>
      controlledCommand === undefined
        ? filter
        : { ...filter, commandId: controlledCommand },
    [filter, controlledCommand],
  );
  const { visible, matches } = useMemo(
    () => applyFilter(lines, effective),
    [lines, effective],
  );
  const indexOfLine = useCallback(
    (n: number) => visible.findIndex((line) => line.n === n),
    [visible],
  );

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 20,
  });

  /* Follow mode */

  const setFollowing = useCallback((next: boolean) => {
    following.current = next;
    setFollow(next);
  }, []);

  const jump = useCallback(
    (index: number, align: 'end' | 'center' | 'start') => {
      programmatic.current += 1;
      virtualizer.scrollToIndex(index, { align });
      // The scroll event, if any, arrives before the next frame's callbacks.
      requestAnimationFrame(() => {
        programmatic.current = Math.max(0, programmatic.current - 1);
      });
    },
    [virtualizer],
  );

  // How many rows were shown last time, so new rows can be told apart from
  // a change of filter.
  const shown = useRef(0);
  useEffect(() => {
    const element = scrollRef.current;
    const previous = shown.current;
    shown.current = visible.length;
    if (!follow || !following.current || visible.length === 0 || !element)
      return;
    // New lines landed. If the reader is no longer at the bottom they were at
    // (their scroll may not have fired its event yet), they have moved away:
    // pause rather than drag them back down.
    const added = Math.max(0, visible.length - previous) * ROW;
    const atOldBottom =
      element.scrollTop + element.clientHeight >=
      element.scrollHeight - added - ROW;
    if (added > 0 && previous > 0 && !atOldBottom) {
      setFollowing(false);
      return;
    }
    jump(visible.length - 1, 'end');
  }, [follow, visible.length, jump, setFollowing]);

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const atBottom =
      element.scrollTop + element.clientHeight >= element.scrollHeight - ROW;
    const up = element.scrollTop < lastTop.current;
    if (up && !atBottom) setFollowing(false);
    else if (atBottom && programmatic.current === 0) setFollowing(true);
    lastTop.current = element.scrollTop;
  };

  /* Search */

  const goTo = useCallback(
    (index: number) => {
      setFollowing(false);
      jump(index, 'center');
    },
    [jump, setFollowing],
  );
  const step = (delta: number) => {
    if (matches.length === 0) return;
    const next = (active + delta + matches.length) % matches.length;
    setActive(next);
    goTo(matches[next] ?? 0);
  };
  const latestMatches = useRef(matches);
  useEffect(() => {
    latestMatches.current = matches;
  });
  useEffect(() => {
    setActive(0);
    const first = latestMatches.current[0];
    if (effective.query && first !== undefined) goTo(first);
  }, [effective.query, effective.matchesOnly, goTo]);

  /* Line links */

  const select = useCallback(
    (n: number) => {
      setSelected(n);
      const index = indexOfLine(n);
      if (index >= 0) goTo(index);
    },
    [goTo, indexOfLine],
  );
  useEffect(() => {
    const fromHash = () => {
      const n = lineFromHash(window.location.hash);
      if (n !== null) select(n);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
    // Only on mount and on hash changes; selecting again on every data change would fight the reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setCommand = (next: string | null) => {
    if (onCommandIdChange) onCommandIdChange(next);
    else setFilter((current) => ({ ...current, commandId: next }));
  };
  const toggleSource = (source: LogSource) =>
    setFilter((current) => {
      const sources = new Set(current.sources);
      if (sources.has(source)) sources.delete(source);
      else sources.add(source);
      return { ...current, sources };
    });

  const activeIndex = matches[active];

  return (
    <div
      data-testid={testId}
      className={cx('flex flex-col', className)}
      onKeyDown={(event) => {
        if (event.target !== scrollRef.current) return;
        if (event.key === 'End') {
          event.preventDefault();
          setFollowing(true);
        } else if (event.key === 'Home') {
          event.preventDefault();
          setFollowing(false);
          jump(0, 'start');
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <form
          className="flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            step(1);
          }}
        >
          <Input
            type="search"
            icon={<Search />}
            placeholder="Search"
            aria-label="Search the log"
            data-testid="log-search"
            value={filter.query}
            onChange={(event) =>
              setFilter((current) => ({
                ...current,
                query: event.target.value,
              }))
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter' && event.shiftKey) {
                event.preventDefault();
                step(-1);
              }
            }}
            className="w-44"
          />
          <span
            className="min-w-14 text-xs text-fg-secondary tabular-nums"
            data-testid="log-match-count"
            aria-live="polite"
          >
            {filter.query
              ? matches.length === 0
                ? 'No matches'
                : `${active + 1} of ${matches.length}`
              : ''}
          </span>
          <IconButton
            label="Previous match"
            icon={<ChevronUp />}
            size="sm"
            variant="ghost"
            type="button"
            disabled={matches.length === 0}
            onClick={() => step(-1)}
          />
          <IconButton
            label="Next match"
            icon={<ChevronDown />}
            size="sm"
            variant="ghost"
            type="button"
            disabled={matches.length === 0}
            onClick={() => step(1)}
          />
        </form>
        <Switch
          label="Matches only"
          checked={filter.matchesOnly}
          disabled={filter.query.length === 0}
          onCheckedChange={(checked) =>
            setFilter((current) => ({ ...current, matchesOnly: checked }))
          }
          data-testid="log-matches-only"
        />
        <div
          role="group"
          aria-label="Sources"
          className="flex items-center gap-1"
        >
          {logSources.map((source) => (
            <button
              key={source}
              type="button"
              aria-pressed={filter.sources.has(source)}
              data-testid={`log-source-${source}`}
              onClick={() => toggleSource(source)}
              className={cx(
                'press rounded-md border px-2 py-0.5 font-mono text-xs transition-colors',
                filter.sources.has(source)
                  ? 'border-line-control bg-elevated text-fg'
                  : 'border-transparent text-fg-muted line-through hover:text-fg-secondary',
              )}
            >
              {sourceLabels[source]}
            </button>
          ))}
        </div>
        <div className="w-48">
          <Select
            aria-label="Level"
            value={filter.level}
            onValueChange={(level) =>
              setFilter((current) => ({
                ...current,
                level: level as LogFilter['level'],
              }))
            }
          >
            <SelectItem value="all">All levels</SelectItem>
            <SelectItem value="warn">Warnings and errors</SelectItem>
            <SelectItem value="error">Errors only</SelectItem>
          </Select>
        </div>
        {effective.commandId && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setCommand(null)}
          >
            One command · clear
          </Button>
        )}
        <span
          className="ml-auto text-xs text-fg-secondary tabular-nums"
          data-testid="log-count"
        >
          {visible.length === lines.length
            ? `${lines.length.toLocaleString()} lines`
            : `${visible.length.toLocaleString()} of ${lines.length.toLocaleString()} lines`}
        </span>
        <CopyButton
          label="Copy shown lines"
          text={() => linesToText(visible)}
          disabled={visible.length === 0}
        />
        <CopyButton
          label="Copy link to the selected line"
          disabled={selected === null}
          text={() =>
            `${window.location.origin}${window.location.pathname}${window.location.search}${lineHash(selected ?? 0)}`
          }
        />
        <Button
          size="sm"
          variant={follow ? 'secondary' : 'primary'}
          icon={<ArrowDownToLine />}
          onClick={() => setFollowing(true)}
          data-testid="log-follow"
          data-follow={follow}
          aria-pressed={follow}
        >
          {follow ? 'Following' : 'Follow'}
        </Button>
      </div>

      <div
        ref={scrollRef}
        data-testid="log-scroll"
        role="region"
        aria-label="Log lines"
        tabIndex={0}
        onScroll={onScroll}
        className="relative min-h-0 flex-1 overflow-auto bg-canvas font-mono text-xs outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      >
        {visible.length === 0 ? (
          <p className="px-4 py-6 text-center font-sans text-sm text-fg-secondary">
            {lines.length === 0 ? 'No output yet.' : 'Nothing matches.'}
          </p>
        ) : (
          <div
            className="relative"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const line = visible[item.index];
              if (!line) return null;
              const isMatch =
                effective.query.length > 0 &&
                matchesQuery(line, effective.query);
              return (
                <Row
                  key={line.n}
                  line={line}
                  query={isMatch ? effective.query : ''}
                  active={item.index === activeIndex}
                  selected={line.n === selected}
                  top={item.start}
                  onSelect={select}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const sourceStyles: Record<LogSource, string> = {
  stdout: 'text-code-foreground',
  stderr: 'text-warning-fg',
  command: 'font-semibold text-fg',
  system: 'text-fg-secondary',
  agent: 'text-info-fg',
};

function Row({
  line,
  query,
  active,
  selected,
  top,
  onSelect,
}: {
  line: LogLine;
  query: string;
  active: boolean;
  selected: boolean;
  top: number;
  onSelect: (n: number) => void;
}) {
  return (
    <div
      data-line={line.n}
      data-source={line.source}
      data-level={line.level}
      data-match={query ? true : undefined}
      data-active={active || undefined}
      data-selected={selected || undefined}
      style={{ transform: `translateY(${top}px)`, height: ROW }}
      className={cx(
        'absolute top-0 left-0 flex min-w-full items-center gap-3 px-3 leading-[22px] whitespace-pre',
        selected && 'bg-accent-subtle',
        active && 'bg-warning-subtle',
      )}
    >
      <a
        href={lineHash(line.n)}
        onClick={(event) => {
          event.preventDefault();
          window.history.replaceState(null, '', lineHash(line.n));
          onSelect(line.n);
        }}
        className="w-14 shrink-0 text-right text-fg-muted tabular-nums select-none hover:text-fg"
      >
        {line.n}
      </a>
      <span className="w-16 shrink-0 text-fg-muted tabular-nums">
        {line.at.slice(11, 19)}
      </span>
      <span
        className={cx(
          sourceStyles[line.source],
          line.level === 'error' && 'text-error-fg',
          line.level === 'warn' &&
            line.source !== 'stderr' &&
            'text-warning-fg',
        )}
      >
        {query ? highlight(line.text, query) : line.text}
      </span>
    </div>
  );
}

function highlight(text: string, query: string): ReactNode {
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  let from = 0;
  for (;;) {
    const at = lower.indexOf(needle, from);
    if (at < 0) break;
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className="rounded-sm bg-warning text-on-warning">
        {text.slice(at, at + query.length)}
      </mark>,
    );
    from = at + query.length;
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}
