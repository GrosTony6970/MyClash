'use client';

import Image from 'next/image';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, fetchMe } from '@myclash/api-client';
import { getApiUrl } from '../src/lib/api-url';
import { resolveStaffSession } from '../src/lib/staff-session-decision';

/**
 * Root page - checks auth and redirects:
 * - a staff PIN session, or a claimed account -> /lices
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

  useEffect(() => {
    void (async () => {
      const staff = await apiRequest(apiUrl, '/api/v1/staff-auth/me');
      // Only asked when there is no PIN session — the common pad case answers
      // on the first call.
      const account = staff.ok ? null : await fetchMe(apiUrl);
      const decision = resolveStaffSession(staff.ok, account?.ok ? account.data : null);
      // Offline lands here too: neither session can be verified, and /login is
      // what this page has always done about that. The running pad at
      // /matches/[matchId] is not gated by any of this.
      router.replace(decision.kind === 'allow' ? '/lices' : '/login');
    })();
  }, [apiUrl, router]);

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
