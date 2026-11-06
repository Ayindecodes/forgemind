'use client';

import { useEffect, useMemo, useState } from 'react';

import { LogViewer } from '@/components/logs/log-viewer';
import { Switch } from '@/components/ui/checkbox';
import type { LogLine } from '@/lib/logs/log-lines';

import { generateLogLines } from './demo-logs';

const LINES = 100_000;
/** Simulated output arrives in small bursts, like a test runner's. */
const BURST_EVERY_MS = 100;
const BURST = 5;

export function LogsDemo() {
  const generated = useMemo(() => generateLogLines(LINES), []);
  const [extra, setExtra] = useState<LogLine[]>([]);
  const [streaming, setStreaming] = useState(false);
  const lines = useMemo(
    () => (extra.length === 0 ? generated : [...generated, ...extra]),
    [generated, extra],
  );

  useEffect(() => {
    if (!streaming) return;
    const timer = setInterval(() => {
      setExtra((current) => {
        const from = generated.length + current.length;
        const burst = generateLogLines(from + BURST, 11)
          .slice(from)
          .map((line, index) => ({
            ...line,
            n: from + index + 1,
            at: new Date().toISOString(),
          }));
        return [...current, ...burst];
      });
    }, BURST_EVERY_MS);
    return () => clearInterval(timer);
  }, [streaming, generated.length]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <p className="text-sm text-fg-secondary">
          <span data-testid="log-lines-count">
            {lines.length.toLocaleString()}
          </span>{' '}
          generated lines. Nothing here is real output.
        </p>
        <Switch
          label="Simulate output"
          description={`${BURST} lines every ${BURST_EVERY_MS}ms`}
          checked={streaming}
          onCheckedChange={setStreaming}
          data-testid="log-simulate"
        />
      </div>
      <LogViewer lines={lines} className="material-solid h-[32rem]" />
    </div>
  );
}
