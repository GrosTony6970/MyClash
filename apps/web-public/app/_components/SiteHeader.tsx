'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { fetchMe } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { signOut } from '@/lib/phone-alerts';
import {
  resolvePublicPersonal,
  type PublicPersonalDecision,
} from '@/components/public-personal-decision';
import { LanguageSwitcher, useI18n } from '@myclash/next-i18n/client';

/** The visitor's name in the header: an account's opens `/me`, a guest's her schedule. */
function NameChip({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-semibold text-foreground-secondary transition hover:border-accent hover:bg-accent/10 focus:outline-none focus:ring-2 focus:ring-accent"
    >
      {children}
    </Link>
  );
}

function SignOutIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path
        fillRule="evenodd"
        d="M3 4a1 1 0 0 1 1-1h7a1 1 0 1 1 0 2H5v10h6a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1V4Zm10.293 3.293a1 1 0 0 1 1.414 0L17.414 10l-2.707 2.707a1 1 0 1 1-1.414-1.414L14.586 10H8a1 1 0 1 1 0-2h6.586l-1.293-1.293a1 1 0 0 1 0-1.414Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/**
 * Shared global header for the public site.
 *
 * Who the visitor is comes from `/me` (operator ruling 262), through the resolver
 * `PublicPersonalShell` uses:
 *
 *   - `sign_in`    → MyClash logo + name + Sign in button (green). A guest's
 *                    name stands beside it and opens her schedule at her Event
 *                    (operator ruling 268): she may have an account too.
 *   - `allow`      → MyClash logo + name + display-name chip linking to /me
 *                    + Sign out icon button, and the "Admin workspace" switch
 *                    for an account that also holds an admin grant.
 *   - not asked yet, or `unverified` (the API could not be asked) → neither.
 *     A failed read is not a signed-out visitor.
 *
 * It used to look for the login cookie in `document.cookie`. That cookie is
 * httpOnly, so the look always failed, and a signed-in visitor read "Sign in".
 *
 * Mounted in app/layout.tsx so it renders on every public route. A sign-in is a
 * client-side navigation, so `MaybeSiteHeader` mounts it again when the visitor
 * leaves a sign-in door (`sign-in-doors.ts`), and it asks again. A read that
 * failed is not asked again until then.
 */
export function SiteHeader() {
  const { t } = useI18n();

  // `null` until `/me` answers: the server render and the first paint show neither button.
  const [visitor, setVisitor] = useState<PublicPersonalDecision | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const apiUrl = getPublicApiUrl();
  const adminUrl = process.env['NEXT_PUBLIC_ADMIN_URL'] ?? 'https://admin.myclash.fr';

  useEffect(() => {
    const controller = new AbortController();
    void fetchMe(apiUrl, { signal: controller.signal }).then((result) => {
      if (!result.ok && result.kind === 'aborted') return;
      setVisitor(resolvePublicPersonal(result.ok ? result.data : null, result.ok));
    });
    return () => controller.abort();
  }, [apiUrl]);

  async function handleSignOut() {
    if (loggingOut) return;
    setLoggingOut(true);
    await signOut(apiUrl, '/');
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

          {visitor?.kind === 'sign_in' && (
            <div className="flex items-center gap-2">
              {visitor.guest && (
                <NameChip href={visitor.guest.scheduleHref}>{visitor.guest.name}</NameChip>
              )}
              <Link
                href="/login"
                className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-accent-foreground transition hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {t('publicApp.home.signIn')}
              </Link>
            </div>
          )}

          {visitor?.kind === 'allow' && (
            <div className="flex items-center gap-2">
              {visitor.hasAdminAccess && (
                <a
                  href={`${adminUrl}/dashboard`}
                  className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm font-semibold text-accent transition hover:bg-accent/20 focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  {t('publicApp.home.adminWorkspace')}
                </a>
              )}
              <NameChip href="/me">
                {visitor.displayName ?? t('publicApp.home.signedInFallback')}
              </NameChip>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                disabled={loggingOut}
                aria-label={t('publicApp.personalShell.logout')}
                className="rounded-md border border-border p-2 text-foreground-secondary transition hover:border-accent hover:text-accent disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <SignOutIcon />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
