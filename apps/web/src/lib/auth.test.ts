import { describe, expect, it } from 'vitest';

import { ApiRequestError } from './api-client';
import {
  safeNext,
  sessionRefusal,
  signInHref,
  rememberNext,
  takeNext,
} from './auth';

describe('signInHref', () => {
  it('keeps the destination', () => {
    expect(signInHref('/tasks/task-2')).toBe('/sign-in?next=%2Ftasks%2Ftask-2');
    expect(signInHref('/')).toBe('/sign-in');
    expect(signInHref()).toBe('/sign-in');
  });
});

describe('sessionRefusal', () => {
  it('reads the reason from a 401 and ignores everything else', () => {
    expect(
      sessionRefusal(
        new ApiRequestError('unauthorized', 'x', 401, { reason: 'expired' }),
      ),
    ).toBe('expired');
    expect(sessionRefusal(new ApiRequestError('unauthorized', 'x', 401))).toBe(
      'signed_out',
    );
    expect(
      sessionRefusal(new ApiRequestError('not_found', 'x', 404)),
    ).toBeNull();
    expect(sessionRefusal(new Error('boom'))).toBeNull();
  });
});

describe('safeNext', () => {
  it('allows only paths on this app', () => {
    expect(safeNext('/tasks')).toBe('/tasks');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});

describe('the next target across the GitHub round trip', () => {
  it('is taken once, and only as a path on this app', () => {
    const items = new Map<string, string>();
    const storage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    };
    rememberNext('/tasks/task-2', storage);
    expect(takeNext(storage)).toBe('/tasks/task-2');
    expect(takeNext(storage)).toBe('/');
    rememberNext('https://evil.example', storage);
    expect(takeNext(storage)).toBe('/');
  });

  it('falls back to the overview without a window', () => {
    expect(takeNext(undefined)).toBe('/');
  });
});
