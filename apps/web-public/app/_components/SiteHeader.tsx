'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { fetchMe } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { resolvePublicPersonal } from '@/components/public-personal-decision';
import { LanguageSwitcher, useI18n } from '@myclash/next-i18n/client';

type AuthState = 'unknown' | 'signed-out' | 'signed-in';

// Auth state is derived from the session cookie via useSyncExternalStore — the
// SSR-safe, lint-clean way to read an external source. Server snapshot is
// 'unknown' (renders neither auth button, matching the SSR HTML); after
// hydration the client snapshot reads the cookie, so there's no hydration
// mismatch and no setState-in-effect. The cookie only changes on login/logout,
// which navigate away, so the subscription is a no-op.
const subscribeAuth = (): (() => void) => () => {};
function readAuthSnapshot(): AuthState {
  return document.cookie.includes('sb-access-token=') ? 'signed-in' : 'signed-out';
}
function readAuthServerSnapshot(): AuthState {
  return 'unknown';
}

/**
 * Shared global header for the public site.
 *
 * Two states branched on the Supabase session cookie (`sb-access-token`):
 *
 *   - Signed out → MyClash logo + name + Sign in button (green).
 *   - Signed in  → MyClash logo + name + display-name chip linking to /me
 *                  + Sign out icon button.
 *
 * Mounted in app/layout.tsx so it renders on every public route. Avoids
 * the previous Personal-space-link confusion (that link routed to the
 * same place as Sign in for signed-out users).
 */
export function SiteHeader() {
  const { t } = useI18n();

  const authState = useSyncExternalStore(subscribeAuth, readAuthSnapshot, readAuthServerSnapshot);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [hasAdminAccess, setHasAdminAccess] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const apiUrl = getPublicApiUrl();
  const adminUrl = process.env['NEXT_PUBLIC_ADMIN_URL'] ?? 'https://admin.myclash.fr';

  // Fetch the display name once the client knows the user is signed in. The
  // setState lives in the async .then (not the effect body), so it doesn't trip
  // set-state-in-effect.
  useEffect(() => {
    if (authState !== 'signed-in') return;
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/me/personal-space`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { user?: { display_name?: string; email?: string } };
        const name = data.user?.display_name?.trim() || data.user?.email || null;
        setDisplayName(name);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
      });

    // Admin-access probe — a competitor who also holds an organiser/super-admin
    // grant gets an "Admin workspace" switch (they land here on the public root
    // after an admin Google login, so the affordance must live on this header).
    // Through the same resolver PublicPersonalShell uses. This derivation —
    // "a platform tier OR any org membership OR a league grant" — was written
    // out here a second time, and a union spelled twice is a union that drifts.
    void fetchMe(apiUrl, { signal: controller.signal }).then((result) => {
      if (!result.ok) return;
      const decision = resolvePublicPersonal(result.data);
      setHasAdminAccess(decision.kind === 'allow' && decision.hasAdminAccess);
    });

    return () => controller.abort();
  }, [authState, apiUrl]);

  async function signOut() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch(`${apiUrl}/api/v1/auth/logout`, { method: 'POST', credentials: 'include' });
    } finally {
      window.location.assign('/');
    }
  }

  return (
    <header className="border-b border-border bg-surface shadow-sm">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-md focus:outline-none focus:ring-2 focus:ring-accent"
          aria-label={t('app.name')}
        >
          <Image
            src="/brand/Logo_nobackground.png"
            alt=""
            width={48}
            height={48}
            priority
            className="h-10 w-10 sm:h-12 sm:w-12"
          />
          <div className="flex flex-col">
            <span className="font-display text-lg font-semibold leading-tight text-foreground sm:text-xl">
              {t('app.name')}
            </span>
            <span className="hidden text-xs text-muted sm:block">
              {t('publicApp.home.description')}
            </span>
          </div>
        </Link>

        <div className="flex items-center gap-3">
          <LanguageSwitcher />

          {authState === 'signed-out' && (
            <Link
              href="/login"
              className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-accent-foreground transition hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {t('publicApp.home.signIn')}
            </Link>
          )}

          {authState === 'signed-in' && (
            <div className="flex items-center gap-2">
              {hasAdminAccess && (
                <a
                  href={`${adminUrl}/dashboard`}
                  className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm font-semibold text-accent transition hover:bg-accent/20 focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  {t('publicApp.home.adminWorkspace')}
                </a>
              )}
              <Link
                href="/me"
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-semibold text-foreground-secondary transition hover:border-accent hover:bg-accent/10 focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {displayName ?? t('publicApp.home.signedInFallback')}
              </Link>
              <button
                type="button"
                onClick={() => void signOut()}
                disabled={loggingOut}
                aria-label={t('publicApp.personalShell.logout')}
                className="rounded-md border border-border p-2 text-foreground-secondary transition hover:border-accent hover:text-accent disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path
                    fillRule="evenodd"
                    d="M3 4a1 1 0 0 1 1-1h7a1 1 0 1 1 0 2H5v10h6a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1V4Zm10.293 3.293a1 1 0 0 1 1.414 0L17.414 10l-2.707 2.707a1 1 0 1 1-1.414-1.414L14.586 10H8a1 1 0 1 1 0-2h6.586l-1.293-1.293a1 1 0 0 1 0-1.414Z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
