'use client';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { DataTable, defineColumns } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/states';
import { Status } from '@/components/ui/status';
import { formatCompact, formatDuration } from '@/lib/format';

import { demoTasks, type DemoTask } from './demo-data';

const columns = defineColumns<DemoTask>();

const dateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});

const taskColumns = columns.columns([
  columns.accessor('title', {
    header: 'Task',
    size: 260,
    meta: { grow: 3 },
    cell: ({ getValue }) => (
      <span className="truncate font-medium">{getValue()}</span>
    ),
  }),
  columns.accessor('repository', {
    header: 'Repository',
    size: 150,
    cell: ({ getValue }) => (
      <span className="truncate font-mono text-code text-fg-secondary">
        {getValue()}
      </span>
    ),
  }),
  columns.accessor('status', {
    header: 'Status',
    size: 150,
    cell: ({ getValue }) => <Status status={getValue()} size="sm" />,
  }),
  columns.accessor('durationMs', {
    header: 'Duration',
    size: 100,
    meta: { align: 'right' },
    cell: ({ getValue }) => formatDuration(getValue()),
  }),
  columns.accessor('filesChanged', {
    header: 'Files',
    size: 80,
    meta: { align: 'right' },
  }),
  columns.accessor('tokens', {
    header: 'Tokens',
    size: 100,
    meta: { align: 'right' },
    cell: ({ getValue }) => formatCompact(getValue()),
  }),
  columns.accessor('updatedAt', {
    header: 'Updated',
    size: 100,
    meta: { align: 'right' },
    cell: ({ getValue }) => dateFormat.format(new Date(getValue())),
  }),
]);

const ROWS = 10_000;

export function TableDemo() {
  const data = useMemo(() => demoTasks(ROWS), []);
  const [mode, setMode] = useState<'data' | 'loading' | 'empty'>('data');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {(['data', 'loading', 'empty'] as const).map((option) => (
          <Button
            key={option}
            size="sm"
            variant={mode === option ? 'primary' : 'secondary'}
            aria-pressed={mode === option}
            onClick={() => setMode(option)}
            data-testid={`table-mode-${option}`}
          >
            {option === 'data' ? '10,000 rows' : option}
          </Button>
        ))}
      </div>
      <DataTable
        caption="Demo engineering tasks"
        columns={taskColumns}
        data={mode === 'data' ? data : []}
        getRowId={(row) => row.id}
        loading={mode === 'loading'}
        initialSorting={[{ id: 'updatedAt', desc: true }]}
        emptyState={
          <EmptyState
            title="No tasks yet"
            description="Connect a repository and start a task to see it here."
            action={<Button variant="primary">New task</Button>}
          />
        }
      />
    </div>
  );
}
