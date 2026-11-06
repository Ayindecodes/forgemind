'use client';

import { useEffect } from 'react';

/**
 * Paper is light. While the page prints, the light tokens apply whatever
 * theme the reader uses on screen; afterwards the choice comes back.
 */
export function usePrintTheme() {
  useEffect(() => {
    const root = document.documentElement;
    let previous: string | null = null;
    const before = () => {
      previous = root.getAttribute('data-theme');
      root.setAttribute('data-theme', 'light');
    };
    const after = () => {
      if (previous === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', previous);
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
}
