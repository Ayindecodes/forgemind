'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cx } from '@/lib/cx';

const pages = [
  { href: '/design', label: 'Foundations' },
  { href: '/design/components', label: 'Components' },
  { href: '/design/logs', label: 'Logs' },
  { href: '/design/perf', label: 'Performance' },
];

export function DesignNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Design pages" className="flex gap-1">
      {pages.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname === href ? 'page' : undefined}
          className={cx(
            'rounded-md px-2.5 py-1 text-sm font-medium transition-colors hover:bg-hover',
            pathname === href ? 'text-fg' : 'text-fg-secondary',
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
