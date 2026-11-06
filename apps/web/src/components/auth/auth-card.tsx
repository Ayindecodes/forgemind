import Link from 'next/link';
import type { ReactNode } from 'react';

import { Logo } from '@/components/brand/logo';
import { cx } from '@/lib/cx';

/** The glass card every sign-in and onboarding screen sits in. */
export function AuthCard({
  title,
  description,
  children,
  wide = false,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={cx(
        'flex w-full flex-col gap-6',
        wide ? 'max-w-3xl' : 'max-w-md',
      )}
    >
      <Link href="/sign-in" className="self-start rounded-md text-fg">
        <Logo size={18} />
      </Link>
      <section className="material-overlay p-6 sm:p-8">
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && <p className="mt-1 text-fg-secondary">{description}</p>}
        <div className="mt-6">{children}</div>
      </section>
    </div>
  );
}
