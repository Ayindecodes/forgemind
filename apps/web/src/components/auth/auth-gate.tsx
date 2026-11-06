'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { Spinner } from '@/components/ui/skeleton';
import { sessionRefusal, signInHref } from '@/lib/auth';
import { useSession } from '@/lib/queries';

/**
 * Sends signed-out people to sign in, expired sessions to the expired page,
 * and members without an organization to onboarding. The real API enforces
 * all of this on its side as well; this is only the courteous front door.
 */
export function AuthGate({
  requireOrganization = true,
  children,
}: {
  requireOrganization?: boolean;
  children: ReactNode;
}) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const refusal = sessionRefusal(session.error);
  const needsOrganization =
    requireOrganization &&
    session.data !== undefined &&
    session.data.organizationId === null;
  const blocked = refusal !== null || needsOrganization;

  // Once the first answer has let the app through, later refetches without
  // data (an unreachable API, a retry) must not pull it away again. The shell
  // itself refetches the session as it mounts, so that would loop forever.
  const [admitted, setAdmitted] = useState(false);
  if (!admitted && !session.isPending && !blocked) setAdmitted(true);

  useEffect(() => {
    if (refusal === 'expired')
      router.replace(`/session-expired?next=${encodeURIComponent(pathname)}`);
    else if (refusal === 'signed_out') router.replace(signInHref(pathname));
    else if (needsOrganization) router.replace('/onboarding');
  }, [refusal, needsOrganization, pathname, router]);

  if (blocked || (session.isPending && !admitted)) {
    return (
      <div
        className="flex min-h-dvh items-center justify-center"
        role="status"
        aria-live="polite"
        data-auth-gate={blocked ? 'redirecting' : 'checking'}
      >
        <span className="flex items-center gap-2 text-sm text-fg-secondary">
          <Spinner label="" />
          {blocked ? 'Redirecting' : 'Checking your session'}
        </span>
      </div>
    );
  }

  return children;
}
