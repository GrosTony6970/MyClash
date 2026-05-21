'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFocusTrap } from '@myclash/ui';
import { useI18n } from '../i18n/I18nProvider';

const orgNavItems = [
  { href: '', labelKey: 'organizer.shell.nav.overview', badge: 'O' },
  { href: 'events', labelKey: 'organizer.shell.nav.events', badge: 'EV' },
  { href: 'settings/ai', labelKey: 'organizer.shell.nav.aiSettings', badge: 'AI' },
  {
    href: 'settings/compensation',
    labelKey: 'organizer.shell.nav.compensationSettings',
    badge: 'C',
  },
] as const;

const eventNavItems = [
  { href: '', labelKey: 'organizer.shell.nav.eventOverview', badge: 'E' },
  { href: 'tournaments', labelKey: 'organizer.shell.nav.tournaments', badge: 'TR' },
  { href: 'clubs', labelKey: 'organizer.shell.nav.clubs', badge: 'CL' },
  { href: 'persons', labelKey: 'organizer.eventHub.sections.persons', badge: 'P' },
  { href: 'pools', labelKey: 'organizer.eventHub.sections.pools', badge: 'P' },
  { href: 'bracket', labelKey: 'organizer.eventHub.sections.bracket', badge: 'B' },
  { href: 'schedule', labelKey: 'organizer.eventHub.sections.schedule', badge: 'S' },
  { href: 'referees', labelKey: 'organizer.eventHub.sections.referees', badge: 'J' },
  {
    href: 'referee-assignments',
    labelKey: 'organizer.eventHub.sections.refereeAssignments',
    badge: 'A',
  },
  { href: 'compensation', labelKey: 'organizer.eventHub.sections.compensation', badge: 'C' },
  { href: 'workshops', labelKey: 'organizer.eventHub.sections.workshops', badge: 'W' },
  { href: 'staff', labelKey: 'organizer.eventHub.sections.staff', badge: 'ST' },
  { href: 'notifications', labelKey: 'organizer.eventHub.sections.notifications', badge: 'N' },
  { href: 'ai-assistant', labelKey: 'organizer.eventHub.sections.aiAssistant', badge: 'AI' },
  { href: 'theme', labelKey: 'organizer.eventHub.sections.theme', badge: 'T' },
  { href: 'leagues', labelKey: 'admin.dashboard.leaguesTitle', badge: 'L' },
  { href: 'archive', labelKey: 'organizer.archive.navLabel', badge: 'A' },
] as const;

function asString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function joinPath(...parts: string[]) {
  return parts
    .filter(Boolean)
    .map((part, index) =>
      index === 0 ? part.replace(/\/+$/u, '') : part.replace(/^\/+|\/+$/gu, ''),
    )
    .join('/');
}

function pickActiveHref(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    const matches = pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
    if (!matches) continue;
    if (best === null || href.length > best.length) best = href;
  }
  return best;
}

export function OrganizerAdminShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const params = useParams<{ slug?: string; eventId?: string }>();
  const slug = asString(params.slug);
  const eventId = asString(params.eventId);
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [orgName, setOrgName] = useState(slug);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [eventName, setEventName] = useState('');
  const [orgEvents, setOrgEvents] = useState<Array<{ id: string; name: string; status: string }>>(
    [],
  );

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
          admin?: {
            isSuperAdmin?: boolean;
            organizations?: Array<{ slug: string }>;
          };
        };
        const hasOrganizationAccess = Boolean(
          data.admin?.organizations?.some((organization) => organization.slug === slug),
        );

        if (data.type !== 'claimed' || (!data.admin?.isSuperAdmin && !hasOrganizationAccess)) {
          window.location.replace('/login');
        }
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          window.location.replace('/login');
        }
      });

    return () => controller.abort();
  }, [apiUrl, slug]);

  useEffect(() => {
    if (!slug) return;
    const controller = new AbortController();

    fetch(`${apiUrl}/api/v1/organizations/slug/${encodeURIComponent(slug)}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const org = (await res.json()) as { id?: string; name?: string };
        if (org.name) setOrgName(org.name);
        if (org.id) setOrgId(org.id);
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [apiUrl, slug]);

  useEffect(() => {
    if (!eventId) {
      return;
    }
    const controller = new AbortController();

    fetch(`${apiUrl}/api/v1/events/${eventId}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const event = (await res.json()) as { name?: string };
        setEventName(event.name ?? '');
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [apiUrl, eventId]);

  // Fetch the org's events for the switcher dropdown. Only runs once the
  // org id has been resolved AND we're inside an event-scoped page.
  useEffect(() => {
    if (!eventId || !orgId) return;
    const controller = new AbortController();

    fetch(`${apiUrl}/api/v1/organizations/${orgId}/events`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as Array<{ id: string; name: string; status: string }>;
        setOrgEvents(data);
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [apiUrl, orgId, eventId]);

  const orgBase = `/org/${slug}`;
  const eventBase = eventId ? `/org/${slug}/events/${eventId}` : '';
  const navSections = useMemo(
    () => [
      {
        key: 'org',
        title: t('organizer.shell.organizationSection'),
        items: orgNavItems.map((item) => ({
          ...item,
          href: joinPath(orgBase, item.href),
        })),
      },
      ...(eventId
        ? [
            {
              key: 'event',
              title: t('organizer.shell.eventSection'),
              items: eventNavItems.map((item) => ({
                ...item,
                href: joinPath(eventBase, item.href),
              })),
            },
          ]
        : []),
    ],
    [eventBase, eventId, orgBase, t],
  );

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
    <nav aria-label={t('organizer.shell.navigationLabel')} className="flex flex-col gap-6">
      {navSections.map((section, idx) => {
        const activeHref = pickActiveHref(
          pathname,
          section.items.map((i) => i.href),
        );
        return (
          <div key={section.key} className={idx === 0 ? '' : 'border-t border-slate-800 pt-5'}>
            <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              {section.title}
            </p>
            <div className="flex flex-col gap-1">
              {section.items.map((item) => {
                const active = item.href === activeHref;
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
                          : 'border-slate-600 bg-slate-900 text-amber-500 group-hover:border-slate-400',
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
        );
      })}
    </nav>
  );

  const logoutAction = (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-md border border-slate-700 bg-slate-950/40 px-3 py-2 text-left text-sm font-semibold text-slate-200 transition-colors hover:border-red-700/60 hover:bg-red-800/15 hover:text-white disabled:cursor-wait disabled:opacity-70"
      aria-label={t('organizer.shell.logoutAriaLabel')}
      disabled={loggingOut}
      onClick={() => {
        void handleLogout();
      }}
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-slate-600 bg-slate-900 text-[0.65rem] font-bold text-amber-500"
        aria-hidden="true"
      >
        LO
      </span>
      <span>{loggingOut ? t('organizer.shell.loggingOut') : t('organizer.shell.logout')}</span>
    </button>
  );

  return (
    <div className="min-h-screen bg-stone-50 text-slate-900">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-red-800 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        {t('organizer.shell.skipToContent')}
      </a>

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 flex-col border-r border-slate-800 bg-slate-900 px-4 py-5 text-white lg:flex">
        <Link href={orgBase} className="mb-7 flex items-center gap-3">
          <Image
            src="/brand/Logomini_nobackground.png"
            alt=""
            width={44}
            height={44}
            className="h-11 w-11"
            priority
          />
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-medium tracking-wide">
              {t('organizer.shell.brand')}
            </p>
            <p className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-500">
              {orgName || slug}
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
              aria-label={t('organizer.shell.openMenu')}
              onClick={() => setOpen(true)}
            >
              <span className="flex flex-col gap-1" aria-hidden="true">
                <span className="h-0.5 w-5 rounded bg-current" />
                <span className="h-0.5 w-5 rounded bg-current" />
                <span className="h-0.5 w-5 rounded bg-current" />
              </span>
            </button>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-red-800">
                {eventId ? t('organizer.shell.eventEyebrow') : t('organizer.shell.eyebrow')}
              </p>
              <div className="flex items-center gap-3">
                <p className="truncate font-display text-base font-medium tracking-tight text-slate-900 sm:text-lg">
                  {eventId
                    ? t('organizer.shell.eventTitle', { event: eventName || eventId })
                    : t('organizer.shell.title', { organization: orgName || slug })}
                </p>
                {eventId && orgEvents.length > 0 && (
                  <select
                    aria-label={t('organizer.shell.eventSwitcher.label')}
                    value={eventId}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === '__manage') {
                        router.push(`/org/${slug}/events/manage`);
                      } else if (value !== eventId) {
                        router.push(`/org/${slug}/events/${value}`);
                      }
                    }}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-red-800/30"
                  >
                    {orgEvents.map((ev) => (
                      <option key={ev.id} value={ev.id}>
                        {ev.name}
                        {ev.status === 'running' ? ' • LIVE' : ''}
                      </option>
                    ))}
                    <option disabled>──────────</option>
                    <option value="__manage">{t('organizer.shell.eventSwitcher.manageAll')}</option>
                  </select>
                )}
              </div>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 sm:flex">
            <span className="h-2 w-2 rounded-full bg-red-700" aria-hidden="true" />
            {t('organizer.shell.status')}
          </div>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label={t('organizer.shell.closeMenu')}
            className="absolute inset-0 bg-slate-950/60"
            onClick={() => setOpen(false)}
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('organizer.shell.navigationLabel')}
            className="relative flex h-full w-80 max-w-[85vw] flex-col bg-slate-900 px-4 py-5 text-white shadow-2xl"
          >
            <div className="mb-6 flex items-center justify-between">
              <Link
                href={orgBase}
                className="flex items-center gap-3"
                onClick={() => setOpen(false)}
              >
                <Image src="/brand/Logomini_nobackground.png" alt="" width={40} height={40} />
                <span className="font-display text-lg font-medium">
                  {t('organizer.shell.brand')}
                </span>
              </Link>
              <button
                type="button"
                className="rounded-md border border-slate-600 px-3 py-1 text-sm text-slate-200"
                onClick={() => setOpen(false)}
              >
                {t('organizer.shell.close')}
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
