import type { Metadata } from 'next';

import { DesignNav } from '../design-nav';
import { requireDesignPages } from '../enabled';

import { LogsDemo } from './logs-demo';

export const metadata: Metadata = { title: 'Logs | ForgeMind design' };

export default function DesignLogsPage() {
  requireDesignPages();

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Log viewer</h1>
          <p className="text-fg-secondary">
            A hundred thousand lines, virtualized. Search, filter, follow, copy,
            and link to a line.
          </p>
        </div>
        <DesignNav />
      </div>
      <LogsDemo />
    </main>
  );
}
