import type { Metadata } from 'next';

import { PageHeader, PageLayout } from '@/components/shell/page-layout';
import { ThemeSwitcher } from '@/components/theme-switcher';

export const metadata: Metadata = { title: 'Settings | ForgeMind' };

export default function SettingsPage() {
  return (
    <PageLayout>
      <PageHeader
        title="Settings"
        description="Preferences for this browser."
      />
      <section aria-labelledby="appearance" className="flex flex-col gap-3">
        <h2 id="appearance" className="text-md font-semibold">
          Appearance
        </h2>
        <div className="material-solid flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">Theme</span>
            <span className="text-sm text-fg-secondary">
              Follow the system, or always use dark or light.
            </span>
          </div>
          <ThemeSwitcher />
        </div>
      </section>
    </PageLayout>
  );
}
