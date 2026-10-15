'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useI18n } from '@myclash/next-i18n/client';
import { forgetSchedules } from '@/components/me/schedule-copy';
import { afterSignIn } from '@/lib/sign-in-return';

/**
 * Where a mailed link lands once the server has signed its reader in (`signedInLanding`,
 * API `mailed-link.ts`): the phone may hold the schedule of whoever held it before, so it is
 * removed, as a password or Google sign-in removes it on its own page. Then the page the link
 * named opens, when sign-in may return to it (`afterSignIn`); else the personal space.
 */
function SignedIn() {
  const { t } = useI18n();
  const router = useRouter();
  const next = useSearchParams().get('next');

  useEffect(() => {
    // The phone is this person's now: a schedule it kept was somebody else's.
    forgetSchedules();
    router.replace(afterSignIn(next));
  }, [router, next]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-bold mb-4">{t('auth.oauth.completing')}</h1>
        <p className="text-foreground-secondary">{t('auth.oauth.wait')}</p>
      </div>
    </main>
  );
}

export default function SignedInPage() {
  return (
    <Suspense fallback={null}>
      <SignedIn />
    </Suspense>
  );
}
