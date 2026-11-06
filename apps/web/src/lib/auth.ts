import { ApiRequestError } from '@/lib/api-client';

/** Where to send someone who needs to sign in, remembering where they were. */
export function signInHref(next?: string) {
  return next && next !== '/'
    ? `/sign-in?next=${encodeURIComponent(next)}`
    : '/sign-in';
}

/** Why the API refused a session, if that is what the error was. */
export function sessionRefusal(
  error: unknown,
): 'signed_out' | 'expired' | null {
  if (!(error instanceof ApiRequestError) || error.status !== 401) return null;
  return error.details?.reason === 'expired' ? 'expired' : 'signed_out';
}

/** Only paths on this app may be a "next" target, never another site. */
export function safeNext(value: string | null | undefined) {
  return value && /^\/(?!\/)/.test(value) ? value : '/';
}

const NEXT_KEY = 'forgemind-next';

type NextStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const sessionStorage = (): NextStorage | undefined =>
  typeof window === 'undefined' ? undefined : window.sessionStorage;

/**
 * Where to go after GitHub sends the person back. GitHub only returns the
 * code and state, so the target waits in session storage across the round
 * trip, on this tab alone.
 */
export function rememberNext(next: string, storage = sessionStorage()) {
  try {
    storage?.setItem(NEXT_KEY, safeNext(next));
  } catch {
    // Storage can be unavailable; the person simply lands on the overview.
  }
}

/** The remembered target, taken once; the overview when there is none. */
export function takeNext(storage = sessionStorage()) {
  try {
    const next = safeNext(storage?.getItem(NEXT_KEY));
    storage?.removeItem(NEXT_KEY);
    return next;
  } catch {
    return '/';
  }
}
