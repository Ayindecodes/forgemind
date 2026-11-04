import type { ReactNode } from 'react';

import { designPagesEnabled } from '@/app/design/enabled';
import { AppShell } from '@/components/shell/app-shell';

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell designPages={designPagesEnabled}>{children}</AppShell>;
}
