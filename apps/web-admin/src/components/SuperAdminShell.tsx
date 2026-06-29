'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useFocusTrap } from '@myclash/ui';
import { useI18n } from '../i18n/I18nProvider';
import {
  useNotificationsSummary,
  type NotificationsSummary,
} from '../hooks/useNotificationsSummary';

interface NavItem {
  href: string;
  labelKey: string;
  badge: string;
}

interface NavSection {
  /** i18n key for the section header. */
  headingKey: string;
  items: readonly NavItem[];
}

/**
 * Sidebar IA — items grouped into four sections so 14 entries don't read
 * as one flat wall.
 *
 *   1. Overview        — single dashboard entry.
 *   2. Content         — orgs, users, profiles, clubs, leagues, rulesets.
 *   3. Operations      — frozen results review.
 *   4. Platform health — audit log, system versions, backups, data quality.
 *   5. Settings        — feature flags, AI settings.
 */
const navSections: readonly NavSection[] = [
  {
    headingKey: 'admin.shell.sectionOverview',
    items: [{ href: '/admin', labelKey: 'admin.shell.nav.overview', badge: 'O' }],
  },
  {
    headingKey: 'admin.shell.sectionContent',
    items: [
      { href: '/admin/organizations', labelKey: 'admin.shell.nav.organizations', badge: 'OR' },
      { href: '/admin/users', labelKey: 'admin.shell.nav.users', badge: 'PA' },
      { href: '/admin/fighters', labelKey: 'admin.shell.nav.globalProfiles', badge: 'GP' },
      { href: '/admin/clubs', labelKey: 'admin.shell.nav.clubs', badge: 'C' },
      { href: '/admin/leagues', labelKey: 'admin.shell.nav.leagues', badge: 'L' },
      // Single side-menu entry; the page redirects to /scoring and the
      // RulesetsTopNav pills handle the Scoring | Penalty tab switch.
      // The isActive() check uses startsWith('/admin/rulesets') so the
      // link stays highlighted on both sub-routes.
      { href: '/admin/rulesets', labelKey: 'admin.shell.nav.rulesets', badge: 'R' },
    ],
  },
  {
    headingKey: 'admin.shell.sectionOperations',
    items: [
      {
        href: '/admin/review-queue',
        labelKey: 'admin.reviewQueue.navTitle',
        badge: 'RQ',
      },
      {
        href: '/admin/exchange-edit-requests',
        labelKey: 'admin.shell.nav.frozenResults',
        badge: 'FR',
      },
    ],
  },
  {
    headingKey: 'admin.shell.sectionPlatformHealth',
    items: [
      { href: '/admin/audit-log', labelKey: 'admin.shell.nav.auditLog', badge: 'A' },
      { href: '/admin/system-versions', labelKey: 'admin.shell.nav.systemVersions', badge: 'S' },
      { href: '/admin/backups', labelKey: 'admin.shell.nav.backups', badge: 'B' },
      { href: '/admin/data-quality', labelKey: 'admin.shell.nav.dataQuality', badge: 'DQ' },
      { href: '/admin/hema-ratings', labelKey: 'admin.shell.nav.hemaRatings', badge: 'HR' },
    ],
  },
  {
    headingKey: 'admin.shell.sectionSettings',
    items: [
      { href: '/admin/feature-flags', labelKey: 'admin.shell.nav.featureFlags', badge: 'FF' },
      { href: '/admin/ai-settings', labelKey: 'admin.shell.nav.aiSettings', badge: 'AI' },
    ],
  },
];

function isActive(pathname: string, href: string) {
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SuperAdminShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const drawerRef = useRef<HTMLDivElement>(null);

  useFocusTrap(open, drawerRef);

  // Polls /admin/notifications/summary every 60 s once super-admin is
  // confirmed. Drives the sidebar Review-Queue badge + the header bell.
  const notifications = useNotificationsSummary(apiUrl, isSuperAdmin);

  // Escape closes the mobile drawer.
  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${apiUrl}/api/v1/me`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          window.location.replace('/login');
          return;
        }

        const data = (await res.json()) as {
          type?: string;
          admin?: { isSuperAdmin?: boolean };
        };
        if (data.type !== 'claimed' || !data.admin?.isSuperAdmin) {
          window.location.replace('/login');
          return;
        }
        setIsSuperAdmin(true);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          window.location.replace('/login');
        }
      });

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
    <nav aria-label={t('admin.shell.navigationLabel')} className="flex flex-col gap-6">
      {navSections.map((section, idx) => (
        <div key={section.headingKey} className={idx === 0 ? '' : 'border-t border-border pt-5'}>
          {idx > 0 && (
            <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-muted">
              {t(section.headingKey)}
            </p>
          )}
          <div className="flex flex-col gap-1">
            {section.items.map((item) => {
              const active = isActive(pathname, item.href);
              // The Review-Queue entry gets a numeric pill on top of
              // its standard badge when count > 0. Other entries keep
              // their plain abbreviation pill.
              const count =
                item.href === '/admin/review-queue' ? (notifications?.reviewQueue ?? 0) : 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={[
                    'group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold transition-colors',
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
                  {count > 0 && (
                    <span
                      className="ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold text-danger-foreground"
                      aria-label={t('admin.notifications.pendingCount').replace(
                        '{count}',
                        String(count),
                      )}
                    >
                      {count > 9 ? t('admin.notifications.count9Plus') : String(count)}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const logoutAction = (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-md border border-border bg-background/40 px-3 py-2 text-left text-sm font-semibold text-foreground transition-colors hover:border-danger/60 hover:bg-danger/15 hover:text-foreground disabled:cursor-wait disabled:opacity-70"
      aria-label={t('admin.shell.logoutAriaLabel')}
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
      <span>{loggingOut ? t('admin.shell.loggingOut') : t('admin.shell.logout')}</span>
    </button>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-foreground"
      >
        {t('admin.shell.skipToContent')}
      </a>

      <aside
        data-theme="dark"
        className="fixed inset-y-0 left-0 z-40 hidden w-72 flex-col border-r border-border bg-background px-4 py-5 text-foreground lg:flex"
      >
        <Link href="/admin" className="mb-7 flex items-center gap-3">
          <Image
            src="/brand/Logomini_nobackground.png"
            alt=""
            width={44}
            height={44}
            className="h-11 w-11"
            priority
          />
          <div>
            <p className="font-display text-lg font-medium tracking-wide">
              {t('admin.shell.brand')}
            </p>
            <p className="text-xs font-semibold uppercase tracking-wider text-gold">
              {t('admin.shell.role')}
            </p>
          </div>
        </Link>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">{sidebar}</div>
        <div className="mt-4 border-t border-border pt-4">{logoutAction}</div>
      </aside>

      <header className="fixed inset-x-0 top-0 z-30 border-b border-border bg-background/90 backdrop-blur lg:left-72">
        <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border text-foreground lg:hidden"
              aria-label={t('admin.shell.openMenu')}
              onClick={() => setOpen(true)}
            >
              <span className="flex flex-col gap-1" aria-hidden="true">
                <span className="h-0.5 w-5 rounded bg-current" />
                <span className="h-0.5 w-5 rounded bg-current" />
                <span className="h-0.5 w-5 rounded bg-current" />
              </span>
            </button>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-accent">
                {t('admin.shell.eyebrow')}
              </p>
              <p className="font-display text-base font-medium tracking-tight text-foreground sm:text-lg">
                {t('admin.shell.title')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <NotificationBell summary={notifications} t={t} />
            <div className="hidden items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-muted sm:flex">
              <span className="h-2 w-2 rounded-full bg-danger" aria-hidden="true" />
              {t('admin.shell.status')}
            </div>
          </div>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label={t('admin.shell.closeMenu')}
            className="absolute inset-0 bg-slate-950/40"
            onClick={() => setOpen(false)}
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('admin.shell.navigationLabel')}
            data-theme="dark"
            className="relative flex h-full w-80 max-w-[85vw] flex-col bg-background px-4 py-5 text-foreground shadow-2xl"
          >
            <div className="mb-6 flex items-center justify-between">
              <Link
                href="/admin"
                className="flex items-center gap-3"
                onClick={() => setOpen(false)}
              >
                <Image src="/brand/Logomini_nobackground.png" alt="" width={40} height={40} />
                <span className="font-display text-lg font-medium">{t('admin.shell.brand')}</span>
              </Link>
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1 text-sm text-foreground"
                onClick={() => setOpen(false)}
              >
                {t('admin.shell.close')}
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

// ── NotificationBell ────────────────────────────────────────────────────────

/**
 * Header bell with a red total-pill + dropdown listing each pending
 * source. Click outside or press Escape to close. "Mark seen" is
 * local-only — it just hides the dropdown rows until the next poll;
 * a server-side per-user ack flag is a separate sprint (documented in
 * the dropdown footer hint).
 */
function NotificationBell({
  summary,
  t,
}: {
  summary: NotificationsSummary | null;
  t: (key: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [dismissedUntil, setDismissedUntil] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const reviewQueue = summary?.reviewQueue ?? 0;
  const broadcastFailures = summary?.broadcastFailures ?? 0;
  const aiFindings = summary?.aiFindings ?? 0;
  const aiScanCrashes = summary?.aiScanCrashes ?? 0;
  const total = summary?.total ?? 0;
  // eslint-disable-next-line react-hooks/purity -- Date.now() gates a transient "recently dismissed" badge; exact freshness on render is intentional and harmless
  const showBadge = total > 0 && Date.now() > dismissedUntil;
  const displayCount = total > 9 ? t('admin.notifications.count9Plus') : String(total);

  type Row = { count: number; labelKey: string; href: string | null };
  const rows: Row[] = [
    {
      count: reviewQueue,
      labelKey: 'admin.notifications.source.reviewQueue',
      href: '/admin/review-queue',
    },
    {
      count: broadcastFailures,
      labelKey: 'admin.notifications.source.broadcastFailures',
      href: null, // no dedicated admin page yet — count-only
    },
    {
      count: aiFindings,
      labelKey: 'admin.notifications.source.aiFindings',
      href: '/admin/data-quality',
    },
    {
      count: aiScanCrashes,
      labelKey: 'admin.notifications.source.aiScanCrashes',
      href: '/admin/data-quality',
    },
  ].filter((r) => r.count > 0);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('admin.notifications.bellAriaLabel')}
        aria-expanded={open}
        aria-haspopup="menu"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-muted transition-colors hover:border-muted"
      >
        {/* Inline bell glyph — keeps the shell self-contained, no
            new icon dep. */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <path d="M18 16v-5a6 6 0 1 0-12 0v5l-2 2v1h16v-1l-2-2z" />
          <path d="M10 21a2 2 0 0 0 4 0" />
        </svg>
        {showBadge && (
          <span className="absolute -right-1 -top-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-danger px-1.5 text-[10px] font-bold text-danger-foreground">
            {displayCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-80 rounded-md border border-border bg-surface shadow-lg"
        >
          <div className="border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted">
            {t('admin.notifications.dropdownTitle')}
          </div>
          {rows.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted">
              {t('admin.notifications.allClear')} ✓
            </div>
          ) : (
            <ul className="py-1">
              {rows.map((row) => {
                const content = (
                  <div className="flex items-center justify-between px-4 py-2 text-sm text-foreground hover:bg-background">
                    <span>{t(row.labelKey)}</span>
                    <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-background px-2 py-0.5 text-xs font-bold text-foreground">
                      {row.count}
                    </span>
                  </div>
                );
                return (
                  <li key={row.labelKey}>
                    {row.href ? (
                      <Link href={row.href} onClick={() => setOpen(false)}>
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex items-center justify-between border-t border-border px-4 py-2">
            <button
              type="button"
              onClick={() => {
                // Local-only dismiss for ~5 minutes; the next poll
                // re-surfaces anything still pending.
                setDismissedUntil(Date.now() + 5 * 60_000);
                setOpen(false);
              }}
              title={t('admin.notifications.markSeenHint')}
              className="text-xs font-semibold text-muted hover:text-foreground"
            >
              {t('admin.notifications.markSeen')}
            </button>
            <span className="text-[10px] text-muted">{t('admin.notifications.markSeenHint')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
