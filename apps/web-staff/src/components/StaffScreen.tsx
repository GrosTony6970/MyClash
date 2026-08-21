'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest } from '@myclash/api-client';
import type { StaffRole } from '@myclash/types';
import { getApiUrl } from '../lib/api-url';
import { resolveScreenAccess, type ScreenAccess } from '../lib/screen-access';
import { useScoringTheme } from '../theme/ThemeProvider';

/**
 * Wraps a staff screen and tells the wrong account so, instead of letting it
 * meet a wall of 403s. `resolveScreenAccess` holds the rule and why.
 *
 * ── It renders the screen FIRST and takes it away second ────────────────────
 * Not "wait for the session, then decide". Two reasons, and the second is a
 * hard rule:
 *
 *   - Offline scoring (rule 3). Blocking the pad on a `/staff-auth/me` fetch
 *     would make venue wifi able to blank the scoring screen, which is the one
 *     thing this app must never do.
 *   - The right account is the overwhelmingly common case, so waiting costs
 *     every correct session a spinner to catch the rare wrong one.
 *
 * The cost is that a wrong account sees its screen for one round trip before
 * the refusal replaces it. On a venue LAN that is under a tenth of a second,
 * and the alternative trades a flash for an offline outage.
 *
 * The children element is identical across the pending and allowed states, so
 * React keeps the same tree and nothing under it remounts when the answer
 * arrives.
 */
export function StaffScreen({ requires, children }: { requires: StaffRole; children: ReactNode }) {
  const access = useScreenAccess(requires);
  if (access.kind === 'wrong_role') return <WrongAccount landingPath={access.landingPath} />;
  return <>{children}</>;
}

/**
 * The signed-in staff account's role, resolved once per mount.
 *
 * `GET /api/v1/staff-auth/me` carries `account.role` and is gated on a session
 * rather than on a role, so every screen can ask it. Anything other than a
 * clean answer leaves the role `null`, which `resolveScreenAccess` reads as
 * "allow" — an organiser's claimed-account session and an unreachable API both
 * land there deliberately.
 */
function useScreenAccess(requires: StaffRole): ScreenAccess {
  const [role, setRole] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const staff = await apiRequest<{ account?: { role?: unknown } }>(
        getApiUrl(),
        '/api/v1/staff-auth/me',
      );
      if (cancelled || !staff.ok) return;
      setRole(staff.data.account?.role ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return resolveScreenAccess(requires, role);
}

/**
 * Names the problem and offers the one thing that fixes it in a tap: the screen
 * this account DOES work. A bare "not allowed" would leave a volunteer at a
 * shared tablet with no idea whether to change screen or change account.
 */
function WrongAccount({ landingPath }: { landingPath: string }) {
  const { t } = useI18n();
  const { chromeScope } = useScoringTheme();

  return (
    <main data-theme={chromeScope} className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center p-4">
        <div className="rounded-lg border border-warning bg-surface p-6 text-center">
          <h1 className="font-display text-xl font-bold">{t('scoring.access.wrongRoleTitle')}</h1>
          <p className="mt-2 text-sm text-muted">{t('scoring.access.wrongRoleBody')}</p>
          <Link
            href={landingPath}
            className="mt-4 inline-flex min-h-[44px] items-center rounded-lg border border-success px-5 text-sm font-bold text-success"
          >
            {t('scoring.access.wrongRoleAction')}
          </Link>
        </div>
      </div>
    </main>
  );
}
