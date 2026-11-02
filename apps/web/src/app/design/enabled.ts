import { notFound } from 'next/navigation';

/** The design pages exist in development and in builds that ask for them. */
export const designPagesEnabled =
  process.env.NODE_ENV !== 'production' ||
  process.env.ENABLE_DESIGN_PAGE === '1';

export function requireDesignPages() {
  if (!designPagesEnabled) notFound();
}
