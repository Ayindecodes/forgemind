import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import AppError from '@/app/(app)/error';
import GlobalError from '@/app/global-error';

describe('error pages', () => {
  it('say what happened and offer a way forward', () => {
    const html = renderToString(
      <AppError
        error={Object.assign(new Error('boom'), { digest: 'abc123' })}
        reset={() => {}}
      />,
    );
    expect(html).toContain('This page hit an error');
    expect(html).toContain('Try again');
    expect(html).toContain('Back to overview');
    expect(html).toContain('abc123');
  });

  it('survive without the design system', () => {
    const html = renderToString(
      <GlobalError error={new Error('root failed')} reset={() => {}} />,
    );
    expect(html).toContain('ForgeMind could not load');
    expect(html).toContain('Reload');
    expect(html).toContain('root failed');
  });
});
