'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { LanguageSwitcher, useI18n } from '@myclash/next-i18n/client';
import { apiRequest, type MeSession } from '@myclash/api-client';
import { resolveLeagueWorkspaceDecision } from './league-workspace-decision';
import { IdentityUnverifiedBanner } from './IdentityUnverifiedBanner';
import { useIdentityGate } from '../hooks/useIdentityGate';
import { getPublicApiUrl } from '../lib/api-url';

/**
 * Chrome for the personal league workspace (/leagues).
 *
 * Deliberately a slim top bar rather than a third copy of the ~200 lines of
 * aside + drawer + focus-trap the super-admin and organizer shells share: this
 * workspace has exactly one destination, and a collapsible rail holding a
 * single item is dead weight. If it ever grows a second section, lift the
 * organizer shell's rail rather than regrowing one here.
 *
 * OrganizerAdminShell cannot be reused: it calls useOrganizerSelectedEvent(),
 * which throws outside a provider that itself requires an org slug — and a
 * league admin may belong to no org at all.
 */
export function LeagueWorkspaceShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const router = useRouter();
  const apiUrl = getPublicApiUrl();
  const [loggingOut, setLoggingOut] = useState(false);
  const identity = useIdentityGate<MeSession>(apiUrl);

  // Derived during render rather than copied into state — nothing else writes
  // it, so state would buy a second source of truth and a cascading render.
  const decision =
    identity.state.status === 'resolved' ? resolveLeagueWorkspaceDecision(identity.state.me) : null;

  // The only thing left for an effect: navigating away.
  useEffect(() => {
    // `unreachable` deliberately does NOT redirect. This shell used to send the
    // operator to /login from both `!res.ok` and its catch, and neither branch
    // was ever the signed-out path: being signed out is a 200 carrying
    // `type: 'anonymous'`, which the decision below already handles. What those
    // branches actually caught was a 5xx, a 429 or dropped wifi — and answered
    // each by signing the operator out. Matches the fix both admin shells took
    // in 00d19114.
    if (identity.state.status === 'checking' || identity.state.status === 'unreachable') return;
    if (identity.state.status === 'denied' || decision?.kind === 'unauthenticated') {
      window.location.replace('/login');
      return;
    }
    if (decision?.kind === 'no_access') {
      // Their session is fine — they just have nothing here. Keep it.
      router.replace(decision.redirectTo);
    }
  }, [identity.state.status, decision, router]);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    // `apiRequest` never throws, so the navigation no longer needs a `finally`
    // to guarantee it runs. A refused logout is still not worth a sentence: the
    // cookie is httpOnly and the browser is leaving for /login either way.
    await apiRequest(apiUrl, '/api/v1/auth/logout', { method: 'POST' });
    window.location.assign('/login');
  }

  // Render nothing behind the gate. Both older shells paint their children
  // before the decision resolves, flashing the workspace at users who are about
  // to be redirected out of it; three lines is a cheap price not to inherit it.
  //
  // `unreachable` is NOT held here. The operator has not been signed out and we
  // cannot tell whether they belong — holding would strand them on a spinner
  // over bad wifi, so the workspace renders with the banner saying the check
  // did not complete.
  if (decision?.kind !== 'allow' && identity.state.status !== 'unreachable') {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">{t('common.loading')}</p>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {identity.state.status === 'unreachable' && (
        <IdentityUnverifiedBanner onRetry={identity.retry} />
      )}
      <header className="sticky top-0 z-header border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-4 px-6 py-3 lg:px-8">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              {t('leagueWorkspace.eyebrow')}
            </p>
            <p className="truncate font-display font-bold text-foreground">
              {t('organizer.shell.brand')}
            </p>
          </div>
          <span className="hidden shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted sm:inline">
            {t('leagueWorkspace.role')}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <LanguageSwitcher className="px-3" />
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              aria-label={t('organizer.shell.logoutAriaLabel')}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted hover:bg-background disabled:opacity-50"
            >
              {loggingOut ? t('organizer.shell.loggingOut') : t('organizer.shell.logout')}
            </button>
          </div>
        </div>
      </header>
      <div id="main-content">{children}</div>
    </div>
  );
}
