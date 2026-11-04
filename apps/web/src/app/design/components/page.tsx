import type { Metadata } from 'next';

import { ThemeSwitcher } from '@/components/theme-switcher';

import { DesignNav } from '../design-nav';
import { requireDesignPages } from '../enabled';

import { Showcase } from './showcase';

export const metadata: Metadata = { title: 'Components | ForgeMind' };

export default function ComponentsPage() {
  requireDesignPages();

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Components</h1>
          <p className="text-fg-secondary">
            Every core component in every state. Hover, focus and pressed states
            are shown with data-preview.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <DesignNav />
          <ThemeSwitcher />
        </div>
      </header>
      <Showcase />
    </main>
  );
}
