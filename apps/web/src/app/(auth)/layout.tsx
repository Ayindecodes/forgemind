import type { ReactNode } from 'react';

/* Signed-out screens. The canvas, a faint grid, and a glass card. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center px-4 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 [background-image:linear-gradient(var(--color-line-subtle)_1px,transparent_1px),linear-gradient(90deg,var(--color-line-subtle)_1px,transparent_1px)] [background-size:32px_32px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
      />
      <main className="relative flex w-full justify-center">{children}</main>
    </div>
  );
}
