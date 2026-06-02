'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { t } from '@myclash/i18n';
import { getApiUrl } from '@/lib/api-url';

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
  const [authState, setAuthState] = useState<'unknown' | 'signed-out' | 'signed-in'>('unknown');
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const apiUrl = getApiUrl();

  useEffect(() => {
    const isSignedIn = document.cookie.includes('sb-access-token=');
    setAuthState(isSignedIn ? 'signed-in' : 'signed-out');
    if (!isSignedIn) return;

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
    return () => controller.abort();
  }, [apiUrl]);

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
    <header className="border-b border-stone-200 bg-white shadow-sm">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
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
            <span className="font-display text-lg font-semibold leading-tight text-slate-900 sm:text-xl">
              {t('app.name')}
            </span>
            <span className="hidden text-xs text-slate-500 sm:block">
              {t('publicApp.home.description')}
            </span>
          </div>
        </Link>

        {authState === 'signed-out' && (
          <Link
            href="/login"
            className="rounded-md bg-red-800 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            {t('publicApp.home.signIn')}
          </Link>
        )}

        {authState === 'signed-in' && (
          <div className="flex items-center gap-2">
            <Link
              href="/me"
              className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-red-400 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400"
            >
              {displayName ?? t('publicApp.home.signedInFallback')}
            </Link>
            <button
              type="button"
              onClick={() => void signOut()}
              disabled={loggingOut}
              aria-label={t('publicApp.personalShell.logout')}
              className="rounded-md border border-stone-300 p-2 text-slate-600 transition hover:border-red-400 hover:text-red-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-400"
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
    </header>
  );
}
