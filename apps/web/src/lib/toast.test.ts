import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearToasts,
  closeToast,
  getToasts,
  removeToast,
  subscribeToToasts,
  toast,
} from './toast';

describe('the toast store', () => {
  beforeEach(() => clearToasts());

  it('adds toasts in order with an info tone by default', () => {
    const first = toast({ title: 'Saved' });
    const second = toast({ title: 'Failed', tone: 'error' });

    expect(getToasts().map(({ id, tone, open }) => [id, tone, open])).toEqual([
      [first, 'info', true],
      [second, 'error', true],
    ]);
  });

  it('closes before it removes, so the exit can animate', () => {
    const id = toast({ title: 'Saved' });

    closeToast(id);
    expect(getToasts()[0]?.open).toBe(false);

    removeToast(id);
    expect(getToasts()).toEqual([]);
  });

  it('notifies subscribers of every change', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToToasts(listener);

    const id = toast({ title: 'Saved' });
    closeToast(id);
    removeToast(id);
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    toast({ title: 'Ignored' });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('returns the same array until something changes', () => {
    const before = getToasts();

    expect(getToasts()).toBe(before);
    toast({ title: 'Saved' });
    expect(getToasts()).not.toBe(before);
  });
});
