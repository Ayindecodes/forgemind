'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cx } from '@/lib/cx';
import { designNav } from '@/lib/navigation';

export function DesignNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Design pages" className="flex gap-1">
      {designNav.map(({ href, label }) => (
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
