'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';

const navItems = [
  { href: '/me', labelKey: 'publicApp.personalShell.nav.dashboard', badge: 'D' },
  { href: '/me/fighter', labelKey: 'publicApp.personalShell.nav.fighter', badge: 'F' },
  { href: '/me/referee', labelKey: 'publicApp.personalShell.nav.referee', badge: 'R' },
  { href: '/me/notifications', labelKey: 'publicApp.personalShell.nav.notifications', badge: 'N' },
  { href: '/me/security', labelKey: 'publicApp.personalShell.nav.security', badge: 'S' },
  { href: '/me/events', labelKey: 'publicApp.personalShell.nav.events', badge: 'E' },
] as const;

function isActive(pathname: string, href: string) {
  if (href === '/me') return pathname === '/me';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PublicPersonalShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [account, setAccount] = useState<{ email: string | null; hasPassword: boolean } | null>(
    null,
  );
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${apiUrl}/api/v1/me`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          window.location.replace('/login');
          return;
        }

        const data = (await response.json()) as { type?: string };
        if (data.type !== 'claimed') {
          window.location.replace('/login');
          return;
        }

        setReady(true);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          window.location.replace('/login');
        }
      });

    return () => controller.abort();
  }, [apiUrl]);

  // Who's signed in (for the sidebar footer) + whether it's a Google-only
  // account. Best-effort; the footer just hides if it can't load.
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/me/security-status`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.ok)
          setAccount((await res.json()) as { email: string | null; hasPassword: boolean });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [apiUrl]);

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

  const sidebar = (
    <nav aria-label={t('publicApp.personalShell.navigationLabel')} className="flex flex-col gap-1">
      {navItems.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={[
              'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold transition-colors',
              active
                ? 'bg-accent text-accent-foreground shadow-sm'
                : 'text-muted hover:bg-foreground/10 hover:text-foreground',
            ].join(' ')}
          >
            <span
              className={[
                'flex h-7 w-7 shrink-0 items-center justify-center rounded border text-[0.65rem] font-bold',
                active
                  ? 'border-foreground/30 bg-foreground/15 text-foreground'
                  : 'border-border bg-background text-gold group-hover:border-muted',
              ].join(' ')}
              aria-hidden="true"
            >
              {item.badge}
            </span>
            <span>{t(item.labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );

  const accountFooter = account?.email ? (
    <div className="px-1">
      <p className="truncate text-xs font-medium text-muted" title={account.email}>
        {account.email}
      </p>
      {!account.hasPassword && (
        <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted">
          {t('publicApp.personalShell.viaGoogle')}
        </p>
      )}
    </div>
  ) : null;

  const logoutAction = (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-md border border-border bg-background/40 px-3 py-2 text-left text-sm font-semibold text-foreground transition-colors hover:border-danger/60 hover:bg-danger/15 hover:text-foreground disabled:cursor-wait disabled:opacity-70"
      aria-label={t('publicApp.personalShell.logoutAriaLabel')}
      disabled={loggingOut}
      onClick={() => {
        void handleLogout();
      }}
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border bg-background text-[0.65rem] font-bold text-gold"
        aria-hidden="true"
      >
        LO
      </span>
      <span>
        {loggingOut ? t('publicApp.personalShell.loggingOut') : t('publicApp.personalShell.logout')}
      </span>
    </button>
  );

  if (!ready) {
    return (
      <main
        data-accent="personal"
        className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground"
      >
        <p className="text-sm font-semibold text-muted">
          {t('publicApp.personalShell.checkingSession')}
        </p>
      </main>
    );
  }

  return (
    <div data-accent="personal" className="min-h-screen bg-background text-foreground">
      <aside
        data-theme="dark"
        className="fixed inset-y-0 left-0 z-40 hidden w-72 flex-col border-r border-border bg-background px-4 py-5 text-foreground shadow-2xl lg:flex"
      >
        <Link href="/me" className="mb-7 flex items-center gap-3">
          <Image
            src="/brand/Logomini_nobackground.png"
            alt=""
            width={44}
            height={44}
            className="h-11 w-11"
            priority
          />
          <div>
            <p className="font-display text-lg font-bold tracking-wide">
              {t('publicApp.personalShell.brand')}
            </p>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">
              {t('publicApp.personalShell.role')}
            </p>
          </div>
        </Link>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">{sidebar}</div>
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          {accountFooter}
          {logoutAction}
        </div>
      </aside>

      <header className="fixed inset-x-0 top-0 z-30 border-b border-border bg-surface/95 shadow-sm backdrop-blur lg:left-72">
        <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border text-foreground lg:hidden"
              aria-label={t('publicApp.personalShell.openMenu')}
              onClick={() => setOpen(true)}
            >
              <span className="flex flex-col gap-1" aria-hidden="true">
                <span className="h-0.5 w-5 rounded bg-current" />
                <span className="h-0.5 w-5 rounded bg-current" />
                <span className="h-0.5 w-5 rounded bg-current" />
              </span>
            </button>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">
                {t('publicApp.personalShell.eyebrow')}
              </p>
              <p className="text-base font-bold text-foreground sm:text-lg">
                {t('publicApp.personalShell.title')}
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-muted sm:flex">
            <span className="h-2 w-2 rounded-full bg-danger" aria-hidden="true" />
            {t('publicApp.personalShell.status')}
          </div>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label={t('publicApp.personalShell.closeMenu')}
            className="absolute inset-0 bg-slate-950/60"
            onClick={() => setOpen(false)}
          />
          <div
            data-theme="dark"
            className="relative flex h-full w-80 max-w-[85vw] flex-col bg-background px-4 py-5 text-foreground shadow-2xl"
          >
            <div className="mb-6 flex items-center justify-between">
              <Link href="/me" className="flex items-center gap-3" onClick={() => setOpen(false)}>
                <Image src="/brand/Logomini_nobackground.png" alt="" width={40} height={40} />
                <span className="font-display text-lg font-bold">
                  {t('publicApp.personalShell.brand')}
                </span>
              </Link>
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1 text-sm text-foreground"
                onClick={() => setOpen(false)}
              >
                {t('publicApp.personalShell.close')}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">{sidebar}</div>
            <div className="mt-4 border-t border-border pt-4">{logoutAction}</div>
          </div>
        </div>
      )}

      <div id="main-content" className="min-h-screen pt-16 lg:pl-72">
        {children}
      </div>
    </div>
  );
}
