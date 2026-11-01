import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { ThemeSync } from '@/components/theme-sync';
import { themeScript } from '@/lib/theme';

import './globals.css';

export const metadata: Metadata = {
  title: 'ForgeMind',
  description: 'Autonomous software engineering and repository intelligence.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
