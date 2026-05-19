'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useFocusTrap } from '@myclash/ui';
import { useI18n } from '../i18n/I18nProvider';

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
      { href: '/admin/rulesets', labelKey: 'admin.shell.nav.rulesets', badge: 'R' },
    ],
  },
  {
    headingKey: 'admin.shell.sectionOperations',
    items: [
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
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const drawerRef = useRef<HTMLDivElement>(null);

  useFocusTrap(open, drawerRef);

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
        }
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
        <div key={section.headingKey} className={idx === 0 ? '' : 'border-t border-slate-800 pt-5'}>
          {idx > 0 && (
            <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              {t(section.headingKey)}
            </p>
          )}
          <div className="flex flex-col gap-1">
            {section.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={[
                    'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold transition-colors',
                    active
                      ? 'bg-red-800 text-white shadow-sm'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded border text-[0.65rem] font-bold',
                      active
                        ? 'border-white/30 bg-white/15 text-white'
                        : 'border-slate-600 bg-slate-900 text-amber-600 group-hover:border-slate-400',
                    ].join(' ')}
                    aria-hidden="true"
                  >
                    {item.badge}
                  </span>
                  <span>{t(item.labelKey)}</span>
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
      className="flex w-full items-center gap-3 rounded-md border border-slate-700 bg-slate-950/40 px-3 py-2 text-left text-sm font-semibold text-slate-200 transition-colors hover:border-red-700/60 hover:bg-red-800/15 hover:text-white disabled:cursor-wait disabled:opacity-70"
      aria-label={t('admin.shell.logoutAriaLabel')}
      disabled={loggingOut}
      onClick={() => {
        void handleLogout();
      }}
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-slate-600 bg-slate-900 text-[0.65rem] font-bold text-amber-600"
        aria-hidden="true"
      >
        LO
      </span>
      <span>{loggingOut ? t('admin.shell.loggingOut') : t('admin.shell.logout')}</span>
    </button>
  );

  return (
    <div className="min-h-screen bg-stone-50 text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 flex-col border-r border-slate-800 bg-slate-900 px-4 py-5 text-white lg:flex">
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
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-500">
              {t('admin.shell.role')}
            </p>
          </div>
        </Link>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">{sidebar}</div>
        <div className="mt-4 border-t border-slate-800 pt-4">{logoutAction}</div>
      </aside>

      <header className="fixed inset-x-0 top-0 z-30 border-b border-slate-200 bg-stone-50/90 backdrop-blur lg:left-72">
        <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 text-slate-700 lg:hidden"
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
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-red-800">
                {t('admin.shell.eyebrow')}
              </p>
              <p className="font-display text-base font-medium tracking-tight text-slate-900 sm:text-lg">
                {t('admin.shell.title')}
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 sm:flex">
            <span className="h-2 w-2 rounded-full bg-red-700" aria-hidden="true" />
            {t('admin.shell.status')}
          </div>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label={t('admin.shell.closeMenu')}
            className="absolute inset-0 bg-slate-950/60"
            onClick={() => setOpen(false)}
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('admin.shell.navigationLabel')}
            className="relative flex h-full w-80 max-w-[85vw] flex-col bg-slate-900 px-4 py-5 text-white shadow-2xl"
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
                className="rounded-md border border-slate-600 px-3 py-1 text-sm text-slate-200"
                onClick={() => setOpen(false)}
              >
                {t('admin.shell.close')}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">{sidebar}</div>
            <div className="mt-4 border-t border-slate-800 pt-4">{logoutAction}</div>
          </div>
        </div>
      )}

      <div id="main-content" className="min-h-screen pt-16 lg:pl-72">
        {children}
      </div>
    </div>
  );
}
