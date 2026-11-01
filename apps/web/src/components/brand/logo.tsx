import type { SVGProps } from 'react';

type BrandProps = Omit<
  SVGProps<SVGSVGElement>,
  'children' | 'viewBox' | 'width' | 'height'
> & { size?: number };

// Drawn on a 16-unit grid so every edge lands on a whole pixel at 16px.
export const MARK_PATH = 'M3 2h11l-3 3H6v9H3zM8 7h3v3H8z';

export function ForgeMark({ size = 16, ...props }: BrandProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d={MARK_PATH} />
    </svg>
  );
}
