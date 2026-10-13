'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, fetchMe } from '@myclash/api-client';
import { getApiUrl } from '../src/lib/api-url';
import { PISTES_ON_ARRIVAL, pisteWithNoNetwork, rememberedPiste } from '../src/lib/last-piste';
import { answeredFault, neverLanded, resolveStaffSession } from '../src/lib/staff-session-decision';

/**
 * Root page - checks auth and redirects:
 * - a staff PIN session, or a claimed account -> /lices, as an arrival: the
 *   piste list opens the last piste at once (`last-piste.ts`)
 * - no network, with the service worker or without it -> the piste the tablet
 *   last had, from its own copy (`pisteWithNoNetwork`): neither session can be
 *   verified, and sign-in cannot work either
 * - anything else -> /login
 *
 * This is the PWA's `start_url` (public/manifest.json), so it is the first
 * thing an installed pad runs. It used to read `/api/v1/me` alone and send
 * anyone it called `anonymous` to /login — but a PIN session lives in the
 * `mc_staff` cookie, which `/me` does not read. So the pad's own credential
 * looked like no credential, and launching the installed app made a signed-in
 * crew re-enter their PIN. It asks about both sessions now, exactly as /lices
 * does, through the same decision.
 *
 * It also read `res.json()` without checking `res.ok`, so a 5xx body parsed
 * into `{ type: undefined }` and routed the user to /lices. `apiRequest`
 * cannot express that.
 */
export default function RootPage() {
  const { t } = useI18n();
  const router = useRouter();
  const apiUrl = getApiUrl();
  const [unchecked, setUnchecked] = useState(false);

  useEffect(() => {
    void (async () => {
      const staff = await apiRequest(apiUrl, '/api/v1/staff-auth/me');
      // Only asked when there is no PIN session — the common pad case answers
      // on the first call.
      const account = staff.ok ? null : await fetchMe(apiUrl);
      const decision = resolveStaffSession(
        staff.ok,
        account?.ok ? account.data : null,
        answeredFault(account),
        neverLanded(staff) || neverLanded(account),
      );
      // A `/me` that answered a fault is not a signed-out session (ruling 295a).
      if (decision.kind === 'unverified') {
        setUnchecked(true);
        return;
      }
      if (decision.kind === 'no_network') {
        router.replace(pisteWithNoNetwork(rememberedPiste()));
        return;
      }
      router.replace(decision.kind === 'allow' ? PISTES_ON_ARRIVAL : '/login');
    })();
  }, [apiUrl, router]);

  if (unchecked) return <SessionUnchecked t={t} />;

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <Image
          src="/brand/Logomini_nobackground.png"
          alt={t('metadata.scoringTitle')}
          width={56}
          height={56}
          priority
          className="mx-auto mb-3 h-14 w-14"
        />
        <p className="text-muted text-sm">{t('common.loading')}</p>
      </div>
    </main>
  );
}

/** `/me` answered a fault: the page could not check, and says so with the one way on. */
function SessionUnchecked({ t }: { t: (key: string) => string }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div role="status" className="max-w-sm text-center">
        <p className="mb-4 text-sm text-muted">{t('common.identityUnchecked')}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-sm text-muted underline hover:text-foreground"
        >
          {t('common.identityRetry')}
        </button>
      </div>
    </main>
  );
}
