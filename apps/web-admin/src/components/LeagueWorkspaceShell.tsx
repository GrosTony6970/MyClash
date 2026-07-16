'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '../i18n/I18nProvider';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher';
import {
  resolveLeagueWorkspaceDecision,
  type LeagueWorkspaceMePayload,
} from './league-workspace-decision';

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
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const [allowed, setAllowed] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${apiUrl}/api/v1/me`, { credentials: 'include', signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          window.location.replace('/login');
          return;
        }
        const decision = resolveLeagueWorkspaceDecision(
          (await res.json()) as LeagueWorkspaceMePayload,
        );
        if (decision.kind === 'unauthenticated') {
          window.location.replace('/login');
          return;
        }
        if (decision.kind === 'no_access') {
          // Their session is fine — they just have nothing here. Keep it.
          router.replace(decision.redirectTo);
          return;
        }
        setAllowed(true);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          window.location.replace('/login');
        }
      });

    return () => controller.abort();
  }, [apiUrl, router]);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch(`${apiUrl}/api/v1/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      window.location.assign('/login');
    }
  }

  // Render nothing behind the gate. Both older shells paint their children
  // before the decision resolves, flashing the workspace at users who are about
  // to be redirected out of it; three lines is a cheap price not to inherit it.
  if (!allowed) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">{t('common.loading')}</p>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
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
