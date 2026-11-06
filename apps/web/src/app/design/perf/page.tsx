import type { Metadata } from 'next';

import { DesignNav } from '../design-nav';
import { requireDesignPages } from '../enabled';

import { DiffDemo, EventsDemo, GlassDemo } from './perf-demos';

export const metadata: Metadata = { title: 'Performance | ForgeMind design' };

export default function DesignPerfPage() {
  requireDesignPages();

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Performance</h1>
          <p className="text-fg-secondary">
            The budgets the perf tests hold the product to, on synthetic data.
          </p>
        </div>
        <DesignNav />
      </div>
      <DiffDemo />
      <EventsDemo />
      <GlassDemo />
    </main>
  );
}
