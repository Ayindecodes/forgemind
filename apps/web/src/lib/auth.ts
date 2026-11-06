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
