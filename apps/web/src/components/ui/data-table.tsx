'use client';

import {
  columnSizingFeature,
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { memo, useRef, useState, type ReactNode } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/states';
import { cx } from '@/lib/cx';
import { formatNumber } from '@/lib/format';

export const tableFeatureSet = tableFeatures({
  rowSortingFeature,
  columnSizingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns,
});

type Features = typeof tableFeatureSet;

/** Typed column definitions for a row shape. */
export function defineColumns<T extends RowData>() {
  return createColumnHelper<Features, T>();
}

type Align = 'left' | 'right';

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TFeatures, TData, TValue> {
    align?: Align;
    /** How much of the spare width this column takes. */
    grow?: number;
  }
}

type DataTableProps<T extends RowData> = {
  columns: ColumnDef<Features, T, unknown>[];
  data: T[];
  /** Read by screen readers. Say what the rows are. */
  caption: string;
  getRowId?: (row: T) => string;
  loading?: boolean;
  emptyState?: ReactNode;
  initialSorting?: SortingState;
  /** Height of the scrolling area. Rows outside it are not rendered. */
  height?: number;
  rowHeight?: number;
  className?: string;
};

const ROW = 'flex w-full border-b border-line-subtle';
const CELL = 'flex h-full min-w-0 items-center px-3';

const cellStyle = (size: number, grow = 1) => ({
  flex: `${grow} 0 ${size}px`,
});

type TableInstance<T extends RowData> = ReturnType<
  typeof useTable<Features, T>
>;
type RowInstance<T extends RowData> =
  TableInstance<T>['getRowModel'] extends () => {
    rows: (infer R)[];
  }
    ? R
    : never;

type RowProps<T extends RowData> = {
  table: TableInstance<T>;
  row: RowInstance<T>;
  index: number;
  start: number;
  height: number;
};

/**
 * Rows are fixed height and never measured, so scrolling costs one render per
 * newly visible row. Memoised, because the table re-renders on every scroll.
 */
function RowInner<T extends RowData>({
  table,
  row,
  index,
  start,
  height,
}: RowProps<T>) {
  return (
    <tr
      role="row"
      aria-rowindex={index + 1}
      data-index={index}
      className={cx(ROW, 'absolute top-0 left-0 hover:bg-hover')}
      style={{ height, transform: `translateY(${start}px)` }}
    >
      {row.getAllCells().map((cell) => {
        const meta = cell.column.columnDef.meta;

        return (
          <td
            key={cell.id}
            role="cell"
            style={cellStyle(cell.column.getSize(), meta?.grow)}
            className={cx(
              CELL,
              meta?.align === 'right' && 'justify-end tabular-nums',
            )}
          >
            <table.FlexRender cell={cell} />
          </td>
        );
      })}
    </tr>
  );
}

const Row = memo(RowInner) as typeof RowInner;

export function DataTable<T extends RowData>({
  columns,
  data,
  caption,
  getRowId,
  loading = false,
  emptyState,
  initialSorting = [],
  height = 480,
  rowHeight = 36,
  className,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const scrollRef = useRef<HTMLDivElement>(null);

  const table = useTable({
    features: tableFeatureSet,
    columns,
    data,
    getRowId,
    state: { sorting },
    onSortingChange: setSorting,
    sortDescFirst: false,
  });

  const rows = table.getRowModel().rows;

  // The virtualizer hands back functions that must not be memoized, so React
  // Compiler skips this component. That is the documented arrangement.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
    getItemKey: (index) => rows[index]?.id ?? index,
  });

  return (
    <div className={cx('material-solid overflow-hidden', className)}>
      <div
        ref={scrollRef}
        className="overflow-auto"
        style={{ maxHeight: height }}
        data-testid="table-scroll"
      >
        <table
          role="table"
          aria-busy={loading || undefined}
          aria-rowcount={rows.length}
          className="grid w-full border-collapse text-sm"
        >
          <caption className="sr-only">{caption}</caption>
          <thead role="rowgroup" className="sticky top-0 z-10 grid bg-elevated">
            {table.getHeaderGroups().map((group) => (
              <tr
                key={group.id}
                role="row"
                className={cx(ROW, 'border-line')}
                style={{ height: rowHeight }}
              >
                {group.headers.map((header) => {
                  const column = header.column;
                  const sorted = column.getIsSorted();
                  const meta = column.columnDef.meta;
                  const content = header.isPlaceholder ? null : (
                    <table.FlexRender header={header} />
                  );

                  return (
                    <th
                      key={header.id}
                      role="columnheader"
                      aria-sort={
                        sorted === 'asc'
                          ? 'ascending'
                          : sorted === 'desc'
                            ? 'descending'
                            : column.getCanSort()
                              ? 'none'
                              : undefined
                      }
                      style={cellStyle(column.getSize(), meta?.grow)}
                      className={cx(
                        CELL,
                        'text-xs font-medium text-fg-secondary',
                        meta?.align === 'right' && 'justify-end',
                      )}
                    >
                      {column.getCanSort() ? (
                        <button
                          type="button"
                          onClick={column.getToggleSortingHandler()}
                          className="press -mx-1.5 flex h-7 items-center pointer-coarse:h-9 gap-1 rounded-sm px-1.5 hover:bg-hover hover:text-fg"
                        >
                          {content}
                          {sorted === 'asc' ? (
                            <ArrowUp aria-hidden="true" className="size-3.5" />
                          ) : sorted === 'desc' ? (
                            <ArrowDown
                              aria-hidden="true"
                              className="size-3.5"
                            />
                          ) : (
                            <ArrowUpDown
                              aria-hidden="true"
                              className="size-3.5 text-fg-muted"
                            />
                          )}
                        </button>
                      ) : (
                        content
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          {loading ? (
            <tbody role="rowgroup" className="grid">
              {Array.from({ length: 8 }, (_, index) => (
                <tr
                  key={index}
                  role="row"
                  className={ROW}
                  style={{ height: rowHeight }}
                >
                  {table.getAllLeafColumns().map((column) => (
                    <td
                      key={column.id}
                      role="cell"
                      style={cellStyle(
                        column.getSize(),
                        column.columnDef.meta?.grow,
                      )}
                      className={CELL}
                    >
                      <Skeleton className="h-3.5 w-2/3" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ) : (
            <tbody
              role="rowgroup"
              className="relative grid"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const row = rows[item.index];
                if (!row) return null;

                return (
                  <Row
                    key={row.id}
                    table={table}
                    row={row}
                    index={item.index}
                    start={item.start}
                    height={rowHeight}
                  />
                );
              })}
            </tbody>
          )}
        </table>
        {!loading && rows.length === 0 && (
          <div className="py-4">
            {emptyState ?? (
              <EmptyState
                title="Nothing here yet"
                description="No rows match."
              />
            )}
          </div>
        )}
      </div>
      <div
        className="flex h-8 items-center border-t border-line px-3 text-xs text-fg-secondary tabular-nums"
        aria-live="polite"
        data-testid="table-footer"
      >
        {loading ? 'Loading' : `${formatNumber(rows.length)} rows`}
      </div>
    </div>
  );
}
