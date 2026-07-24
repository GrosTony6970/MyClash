'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Avatar } from '@myclash/ui';
import { useI18n } from '../i18n/I18nProvider';
import { getPublicApiUrl } from '../lib/api-url';
import { BottomNav } from './BottomNav';
import { MyEventsNav } from './me/MyEventsNav';
import { useUnreadBroadcasts } from './me/useUnreadBroadcasts';

const navItems = [
  { href: '/me', labelKey: 'publicApp.personalShell.nav.dashboard', badge: 'D' },
  { href: '/me/profile', labelKey: 'publicApp.personalShell.nav.profile', badge: 'P' },
  { href: '/me/follows', labelKey: 'publicApp.personalShell.nav.people', badge: 'Pe' },
  { href: '/me/leagues', labelKey: 'publicApp.personalShell.nav.leagues', badge: 'L' },
  { href: '/me/notifications', labelKey: 'publicApp.personalShell.nav.notifications', badge: 'N' },
  { href: '/me/settings', labelKey: 'publicApp.personalShell.nav.settings', badge: 'St' },
  { href: '/me/security', labelKey: 'publicApp.personalShell.nav.security', badge: 'S' },
  { href: '/me/events', labelKey: 'publicApp.personalShell.nav.events', badge: 'E' },
  { href: '/me/instructor', labelKey: 'publicApp.personalShell.nav.instructor', badge: 'In' },
] as const;

function isActive(pathname: string, href: string) {
  // Exact-match the index + the events list: inside an event the MyEventsNav
  // sub-item carries the active state, so "Public events" must not light up.
  if (href === '/me' || href === '/me/events') return pathname === href;
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
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  // True when this competitor account also holds a super-admin / organiser /
  // league grant — drives the "switch to admin workspace" escape hatch for the
  // user who signs in on the public app but manages tournaments on admin.
  const [hasAdminAccess, setHasAdminAccess] = useState(false);
  const apiUrl = getPublicApiUrl();
  const adminUrl = process.env['NEXT_PUBLIC_ADMIN_URL'] ?? 'https://admin.myclash.fr';
  const notificationsUnread = useUnreadBroadcasts(apiUrl);

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

        const data = (await response.json()) as {
          type?: string;
          user?: { email?: string; display_name?: string; photo_url?: string };
          person?: { given_name?: string; family_name?: string };
          admin?: {
            isSuperAdmin?: boolean;
            organizations?: Array<{ slug: string }>;
            hasLeagueRoles?: boolean;
          };
        };
        if (data.type !== 'claimed') {
          window.location.replace('/login');
          return;
        }

        const personName = [data.person?.given_name, data.person?.family_name]
          .filter(Boolean)
          .join(' ')
          .trim();
        setDisplayName(data.user?.display_name || personName || data.user?.email || null);
        setPhotoUrl(data.user?.photo_url ?? null);
        setHasAdminAccess(
          Boolean(
            data.admin &&
            (data.admin.isSuperAdmin ||
              (data.admin.organizations?.length ?? 0) > 0 ||
              data.admin.hasLeagueRoles),
          ),
        );
        setReady(true);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          window.location.replace('/login');
        }
      });

    return () => controller.abort();
  }, [apiUrl]);

  // The /me fetch above only runs on mount, so a photo changed on the co-mounted
  // profile editor wouldn't show here until a full reload. FighterProfileClient
  // dispatches a `myclash:profile-photo` window event on upload/remove; mirror it.
  useEffect(() => {
    const onPhoto = (event: Event) => {
      const detail = (event as CustomEvent<{ url?: string | null }>).detail;
      setPhotoUrl(detail?.url ?? null);
    };
    window.addEventListener('myclash:profile-photo', onPhoto);
    return () => window.removeEventListener('myclash:profile-photo', onPhoto);
  }, []);

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
    <>
      <nav
        aria-label={t('publicApp.personalShell.navigationLabel')}
        className="flex flex-col gap-1"
      >
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
              {item.href === '/me/notifications' && notificationsUnread > 0 && (
                <span
                  className="ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-danger px-1.5 py-0.5 text-[0.65rem] font-bold text-danger-foreground"
                  aria-label={t('publicApp.me.nav.unreadLabel', { count: notificationsUnread })}
                >
                  {notificationsUnread > 9 ? '9+' : notificationsUnread}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <MyEventsNav onNavigate={() => setOpen(false)} />
      {/*
        Cross-domain switch to the admin/organiser workspace. A plain <a> (not a
        Next <Link>) because admin.${DOMAIN} is a separate app; the shared
        .${DOMAIN} session cookie carries the auth across. Target /dashboard so
        dual-role users hit the Platform / Event-organiser chooser there.
      */}
      {hasAdminAccess && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted">
            {t('publicApp.personalShell.adminWorkspaceSection')}
          </p>
          <a
            href={`${adminUrl}/dashboard`}
            className="group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold text-muted transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border bg-background text-[0.65rem] font-bold text-gold group-hover:border-muted"
              aria-hidden="true"
            >
              AW
            </span>
            <span>{t('publicApp.personalShell.nav.adminWorkspace')}</span>
          </a>
        </div>
      )}
    </>
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
        className="fixed inset-y-0 left-0 z-sidebar hidden w-72 flex-col border-r border-border bg-background px-4 py-5 text-foreground shadow-2xl lg:flex"
      >
        <div className="mb-7">
          <Link href="/me" className="flex items-center gap-3">
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
          {displayName && (
            <div className="mt-2 flex items-center gap-2 pl-1">
              <p className="min-w-0 text-[0.7rem] text-muted">
                {t('publicApp.personalShell.loggedAs')}{' '}
                <span className="font-semibold text-foreground">{displayName}</span>
              </p>
              <Avatar size="md" name={displayName} src={photoUrl ?? undefined} />
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">{sidebar}</div>
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          {accountFooter}
          {logoutAction}
        </div>
      </aside>

      <header className="fixed inset-x-0 top-0 z-header border-b border-border bg-surface/95 shadow-sm backdrop-blur lg:left-72">
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
        <div className="fixed inset-0 z-overlay lg:hidden">
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
            {displayName && (
              <div className="mb-4 flex items-center gap-2 pl-1">
                <p className="min-w-0 text-[0.7rem] text-muted">
                  {t('publicApp.personalShell.loggedAs')}{' '}
                  <span className="font-semibold text-foreground">{displayName}</span>
                </p>
                <Avatar size="md" name={displayName} src={photoUrl ?? undefined} />
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">{sidebar}</div>
            <div className="mt-4 border-t border-border pt-4">{logoutAction}</div>
          </div>
        </div>
      )}

      <div id="main-content" className="min-h-screen pt-16 pb-20 lg:pb-0 lg:pl-72">
        {children}
      </div>
      <BottomNav notificationsUnread={notificationsUnread} />
    </div>
  );
}
