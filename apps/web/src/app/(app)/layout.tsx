import type { ReactNode } from 'react';

import { AuthGate } from '@/components/auth/auth-gate';
import { CommandCenter } from '@/components/shell/command-center';
import { MobileNav } from '@/components/shell/mobile-nav';
import { Sidebar } from '@/components/shell/sidebar';
import { TopBar } from '@/components/shell/top-bar';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <CommandCenter>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-1.5 focus:text-sm focus:font-medium focus:text-on-accent"
        >
          Skip to content
        </a>
        <div className="min-h-dvh">
          <div className="print:hidden">
            <Sidebar />
          </div>
          <div className="flex min-h-dvh flex-col transition-[padding] duration-base ease-standard lg:pl-(--sidebar-width) print:pl-0">
            <div className="print:hidden">
              <TopBar />
            </div>
            <main
              id="main"
              tabIndex={-1}
              className="flex-1 px-4 pt-6 pb-24 outline-none md:px-6 md:pb-8 print:p-0"
            >
              {children}
            </main>
          </div>
          <div className="print:hidden">
            <MobileNav />
          </div>
        </div>
      </CommandCenter>
    </AuthGate>
  );
}
