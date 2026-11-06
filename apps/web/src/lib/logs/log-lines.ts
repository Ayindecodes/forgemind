import type { Event, StageId } from '@forgemind/contract';

import { describeEvent } from '@/lib/live/describe-event';

/*
 * The log of a run: every line of command output, with the events around
 * it as system lines, in the order it all happened. Built incrementally so
 * a live run only costs the lines that just arrived. A chunk of output can
 * end mid-line; the rest waits for the next chunk of the same command.
 */

export type LogSource = 'stdout' | 'stderr' | 'command' | 'system' | 'agent';
export type LogLevel = 'info' | 'warn' | 'error';

export type LogLine = {
  /** One-based, stable for the life of the run. */
  n: number;
  at: string;
  seq: number;
  source: LogSource;
  level: LogLevel;
  text: string;
  commandId: string | null;
  stage: StageId | null;
  attempt: number | null;
};

export const logSources: LogSource[] = [
  'stdout',
  'stderr',
  'command',
  'system',
  'agent',
];

export class LogBuilder {
  readonly lines: LogLine[] = [];
  private processed = 0;
  private stage: StageId | null = null;
  private attempt: number | null = null;
  private partial = new Map<string, string>();

  /** Appends the lines for any events not seen before. Returns the lines. */
  append(events: readonly Event[]): LogLine[] {
    for (let index = this.processed; index < events.length; index += 1) {
      const event = events[index];
      if (event) this.add(event);
    }
    this.processed = events.length;
    return this.lines;
  }

  private push(
    event: Event,
    source: LogSource,
    level: LogLevel,
    text: string,
    commandId: string | null = null,
  ) {
    this.lines.push({
      n: this.lines.length + 1,
      at: event.at,
      seq: event.seq,
      source,
      level,
      text,
      commandId,
      stage: this.stage,
      attempt: this.attempt,
    });
  }

  private add(event: Event) {
    switch (event.type) {
      case 'stage.started':
        this.stage = event.stage;
        this.attempt = event.attempt;
        this.push(event, 'system', 'info', describeEvent(event));
        return;
      case 'stage.finished':
        this.push(
          event,
          'system',
          event.status === 'failed' ? 'error' : 'info',
          describeEvent(event),
        );
        return;
      case 'command.started':
        this.push(
          event,
          'command',
          'info',
          describeEvent(event),
          event.commandId,
        );
        return;
      case 'command.output': {
        const text = (this.partial.get(event.commandId) ?? '') + event.text;
        const parts = text.split('\n');
        const rest = parts.pop() ?? '';
        for (const part of parts) {
          this.push(
            event,
            event.stream,
            event.stream === 'stderr' ? 'warn' : 'info',
            part,
            event.commandId,
          );
        }
        if (rest.length > 0) this.partial.set(event.commandId, rest);
        else this.partial.delete(event.commandId);
        return;
      }
      case 'command.finished': {
        const rest = this.partial.get(event.commandId);
        if (rest) {
          this.push(event, 'stdout', 'info', rest, event.commandId);
          this.partial.delete(event.commandId);
        }
        this.push(
          event,
          'command',
          event.exitCode === 0 ? 'info' : 'error',
          describeEvent(event),
          event.commandId,
        );
        return;
      }
      case 'log':
        this.push(event, 'system', event.level, event.text);
        return;
      case 'agent.note':
      case 'operation':
        this.push(event, 'agent', 'info', describeEvent(event));
        return;
      case 'check.finished':
        this.push(
          event,
          'system',
          event.status === 'failed' || event.status === 'error'
            ? 'error'
            : 'info',
          describeEvent(event),
        );
        return;
      case 'retry.scheduled':
        this.push(event, 'system', 'warn', describeEvent(event));
        return;
      case 'run.finished':
        this.push(
          event,
          'system',
          event.error ? 'error' : 'info',
          describeEvent(event),
        );
        return;
      case 'run.started':
      case 'file.inspected':
      case 'file.changed':
      case 'check.started':
      case 'review.finished':
      case 'resources.sampled':
      case 'approval.requested':
        this.push(event, 'system', 'info', describeEvent(event));
        return;
    }
  }
}

export const linesFromEvents = (events: readonly Event[]) =>
  new LogBuilder().append(events);

export type LogFilter = {
  sources: ReadonlySet<LogSource>;
  level: 'all' | 'warn' | 'error';
  commandId: string | null;
  query: string;
  matchesOnly: boolean;
};

export const defaultFilter: LogFilter = {
  sources: new Set(logSources),
  level: 'all',
  commandId: null,
  query: '',
  matchesOnly: false,
};

const levels: Record<LogLevel, number> = { info: 0, warn: 1, error: 2 };

export const matchesQuery = (line: LogLine, query: string) =>
  query.length > 0 && line.text.toLowerCase().includes(query.toLowerCase());

export function passesFilter(line: LogLine, filter: LogFilter) {
  if (!filter.sources.has(line.source)) return false;
  if (filter.level !== 'all' && levels[line.level] < levels[filter.level])
    return false;
  if (filter.commandId && line.commandId !== filter.commandId) return false;
  if (filter.matchesOnly && filter.query && !matchesQuery(line, filter.query))
    return false;
  return true;
}

/** The lines that pass the filter, and which of those match the search. */
export function applyFilter(lines: readonly LogLine[], filter: LogFilter) {
  const visible: LogLine[] = [];
  const matches: number[] = [];
  for (const line of lines) {
    if (!passesFilter(line, filter)) continue;
    if (filter.query && matchesQuery(line, filter.query))
      matches.push(visible.length);
    visible.push(line);
  }
  return { visible, matches };
}

export const linesToText = (lines: readonly LogLine[]) =>
  lines.map(({ text }) => text).join('\n');
