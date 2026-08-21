'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest } from '@myclash/api-client';
import type { StaffRole } from '@myclash/types';
import { getApiUrl } from '../lib/api-url';
import { resolveScreenAccess, type ScreenAccess } from '../lib/screen-access';
import { useScoringTheme } from '../theme/ThemeProvider';
import type { BannerEvent } from './EventBanner';

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
  const { access, session } = useScreenAccess(requires);
  if (access.kind === 'wrong_role') return <WrongAccount landingPath={access.landingPath} />;

  return <StaffSessionContext.Provider value={session}>{children}</StaffSessionContext.Provider>;
}

/**
 * The signed-in session, for the `EventBanner` each screen places itself.
 *
 * ── Why the banner is not rendered here ─────────────────────────────────────
 * It was going to be, so that every gated screen got it without anyone having
 * to remember. It cannot be: the shells in this app pad nothing, and each page
 * opens its own `<main>` with its own `data-theme` scope, its own container and
 * `min-h-screen`. A banner rendered above that `<main>` would sit unpadded and
 * outside the page's theme scope, and would push every screen one banner-height
 * past a single viewport.
 *
 * So the DATA has one owner here, the COMPONENT has one owner in
 * `EventBanner.tsx`, and the page decides where in its own container the banner
 * goes. The scoring pad simply never renders one — which is the right answer
 * for a screen read mid-bout, where a sign-out button must not be reachable.
 */
export interface StaffSession {
  event: BannerEvent | null;
  accountName: string | null;
}

const StaffSessionContext = createContext<StaffSession>({ event: null, accountName: null });

export function useStaffSession(): StaffSession {
  return useContext(StaffSessionContext);
}

/**
 * The signed-in staff account, resolved once per mount.
 *
 * `GET /api/v1/staff-auth/me` carries `account.role` and is gated on a session
 * rather than on a role, so every screen can ask it. Anything other than a
 * clean answer leaves the role `null`, which `resolveScreenAccess` reads as
 * "allow" — an organiser's claimed-account session and an unreachable API both
 * land there deliberately.
 *
 * It also carries the event and the account's display name, which the banner
 * renders. Both ride THIS call rather than a second one: the fetch was already
 * happening on every gated screen and was throwing everything but the role away.
 */
function useScreenAccess(requires: StaffRole): { access: ScreenAccess; session: StaffSession } {
  const [account, setAccount] = useState<StaffMeAccount | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const staff = await apiRequest<{ account?: StaffMeAccount }>(
        getApiUrl(),
        '/api/v1/staff-auth/me',
      );
      if (cancelled || !staff.ok) return;
      setAccount(staff.data.account ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    access: resolveScreenAccess(requires, account?.role ?? null),
    session: { event: bannerEvent(account), accountName: account?.display_name ?? null },
  };
}

/** The `/me` shape this screen reads. Snake-cased — the payload is the raw row. */
interface StaffMeAccount {
  role?: unknown;
  display_name?: string | null;
  events?: {
    name?: string | null;
    kind?: string | null;
    status?: string | null;
    logo_url?: string | null;
  } | null;
}

/**
 * The event, or null while the answer has not landed.
 *
 * Null rather than a placeholder name, so `EventBanner` can fall back to what
 * this tablet remembers signing into instead of rendering an empty title.
 */
function bannerEvent(account: StaffMeAccount | null): BannerEvent | null {
  const event = account?.events;
  if (!event?.name) return null;
  return {
    name: event.name,
    kind: event.kind ?? null,
    status: event.status ?? null,
    logoUrl: event.logo_url ?? null,
  };
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
