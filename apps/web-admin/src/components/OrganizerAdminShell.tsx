'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFocusTrap } from '@myclash/ui';
import { useI18n } from '../i18n/I18nProvider';
import { useOrganizerSelectedEvent } from './organizer-event-context';
import { resolveAuthDecision } from './organizer-auth-decision';
import { pickActiveHref } from './pick-active-href';

const orgNavItems = [
  { href: '', labelKey: 'organizer.shell.nav.overview', badge: 'O' },
  // `exact` prevents the events list from staying highlighted once
  // the operator drills into an event — sub-routes
  // `/org/{slug}/events/{eventId}/...` belong to the Event section.
  { href: 'events', labelKey: 'organizer.shell.nav.events', badge: 'EV', exact: true },
  // Single "Rulesets" entry — the page redirects to /scoring and the
  // RulesetsTopNav pill at the top of each tab handles Scoring | Penalty
  // switching. pickActiveHref() uses startsWith() so the link stays
  // highlighted whether the operator is on /scoring or /penalty.
  { href: 'rulesets', labelKey: 'organizer.shell.nav.rulesets', badge: 'R' },
  { href: 'settings/ai', labelKey: 'organizer.shell.nav.aiSettings', badge: 'AI' },
  {
    href: 'settings/compensation',
    labelKey: 'organizer.shell.nav.compensationSettings',
    badge: 'C',
  },
  // Venues are org-level — operators manage the catalogue from this
  // entry. The event sidebar no longer surfaces venues; the
  // workshop + session venue pickers consume the org catalogue
  // directly.
  { href: 'venues', labelKey: 'organizer.shell.nav.venues', badge: 'V' },
] as const;

const eventNavItems = [
  { href: '', labelKey: 'organizer.shell.nav.eventOverview', badge: 'E' },
  { href: 'tournaments', labelKey: 'organizer.shell.nav.tournaments', badge: 'TR' },
  { href: 'persons', labelKey: 'organizer.eventHub.sections.persons', badge: 'P' },
  { href: 'clubs', labelKey: 'organizer.shell.nav.clubs', badge: 'CL' },
  { href: 'referees', labelKey: 'organizer.eventHub.sections.referees', badge: 'J' },
  { href: 'pools', labelKey: 'organizer.eventHub.sections.pools', badge: 'P' },
  { href: 'bracket', labelKey: 'organizer.eventHub.sections.bracket', badge: 'B' },
  { href: 'schedule', labelKey: 'organizer.eventHub.sections.schedule', badge: 'S' },
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

export function OrganizerAdminShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const params = useParams<{ slug?: string; eventId?: string }>();
  const slug = asString(params.slug);
  const urlEventId = asString(params.eventId);
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  // Event context — provides selectedEventId (URL > localStorage > auto-pick),
  // the full event list for the switcher, and orgName for the brand block.
  const { orgName, orgLogoUrl, events, eventsError, selectedEventId, currentEvent, selectEvent } =
    useOrganizerSelectedEvent();

  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

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

  // Escape closes the event switcher popover.
  useEffect(() => {
    if (!switcherOpen) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setSwitcherOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [switcherOpen]);

  // Outside-click closes the event switcher popover.
  useEffect(() => {
    if (!switcherOpen) return;
    function handleClick(event: MouseEvent) {
      if (switcherRef.current && !switcherRef.current.contains(event.target as Node)) {
        setSwitcherOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [switcherOpen]);

  // Auth gate — verifies the current session has access to this org.
  // `unauthenticated`        → /login (real auth failure).
  // `no_access`              → silent client-side replace to the user's first
  //                            real org. This handles the stale-link case where
  //                            a `<Link>` interpolated `undefined` into the
  //                            slug segment and the user clicked through to
  //                            `/org/undefined/...`. Previously we destroyed
  //                            the session here; that was the source of the
  //                            "logged out after toggling event publish" report.
  // `allow`                  → no-op.
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
        const data = (await res.json()) as Parameters<typeof resolveAuthDecision>[1];
        const decision = resolveAuthDecision(slug, data);
        if (decision.kind === 'unauthenticated') {
          window.location.replace('/login');
        } else if (decision.kind === 'no_access') {
          // eslint-disable-next-line no-console
          console.error('[OrganizerAdminShell] redirecting away from inaccessible slug', {
            slug,
            redirectTo: decision.redirectTo,
            pathname,
          });
          // `router.replace` keeps the session intact and lands the user on
          // a working route. Falls back to a hard nav if the target is /login.
          if (decision.redirectTo === '/login') {
            window.location.replace('/login');
          } else {
            router.replace(decision.redirectTo);
          }
        }
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          window.location.replace('/login');
        }
      });
    return () => controller.abort();
  }, [apiUrl, slug, pathname, router]);

  const orgBase = `/org/${slug}`;
  // Event base resolved from the context's selectedEventId — survives nav
  // to org-scoped routes that have no eventId in the URL.
  const eventBase = selectedEventId ? `/org/${slug}/events/${selectedEventId}` : '';
  const navSections = useMemo(
    () => [
      {
        key: 'org' as const,
        title: t('organizer.shell.organizationSection'),
        items: orgNavItems.map((item) => ({
          ...item,
          href: joinPath(orgBase, item.href),
        })),
      },
      ...(selectedEventId
        ? [
            {
              key: 'event' as const,
              title: t('organizer.shell.eventSection'),
              items: eventNavItems.map((item) => ({
                ...item,
                href: joinPath(eventBase, item.href),
              })),
            },
          ]
        : []),
    ],
    [eventBase, selectedEventId, orgBase, t],
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

  // Picking a new event from the switcher: update context AND navigate to
  // that event's overview. Navigating ensures users on event-scoped routes
  // don't stay pinned to the previous event's tab (e.g. /events/{old}/clubs).
  function handlePickEvent(id: string) {
    selectEvent(id);
    setSwitcherOpen(false);
    router.push(`/org/${slug}/events/${id}`);
  }

  const sidebar = (
    <nav aria-label={t('organizer.shell.navigationLabel')} className="flex flex-col gap-6">
      {navSections.map((section, idx) => {
        const activeHref = pickActiveHref(pathname, section.items);
        const isEventSection = section.key === 'event';
        return (
          <div key={section.key} className={idx === 0 ? '' : 'border-t border-slate-800 pt-5'}>
            {isEventSection ? (
              <div className="relative mb-3 px-2" ref={switcherRef}>
                <button
                  type="button"
                  onClick={() => setSwitcherOpen((v) => !v)}
                  className="flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left transition-colors hover:bg-white/5"
                  aria-haspopup="menu"
                  aria-expanded={switcherOpen}
                  aria-label={t('organizer.shell.eventSwitcher.openLabel')}
                >
                  <span className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    <span>{section.title}</span>
                    <span aria-hidden="true" className="shrink-0 text-slate-400">
                      {switcherOpen ? '▴' : '▾'}
                    </span>
                  </span>
                  {currentEvent ? (
                    <span className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                      <span className="min-w-0 truncate">{currentEvent.name}</span>
                      {currentEvent.status === 'running' && (
                        <span className="shrink-0 rounded bg-red-700/30 px-1 py-px text-[10px] font-bold text-red-300">
                          LIVE
                        </span>
                      )}
                    </span>
                  ) : null}
                </button>
                {switcherOpen && (
                  <div
                    role="menu"
                    className="absolute left-2 right-2 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-slate-700 bg-slate-800 py-1 shadow-xl"
                  >
                    {events.length === 0 ? (
                      eventsError ? (
                        <p role="alert" className="px-3 py-2 text-xs font-medium text-red-300">
                          {t('organizer.shell.eventSwitcher.loadFailed')} ({eventsError})
                        </p>
                      ) : (
                        <p className="px-3 py-2 text-sm italic text-slate-400">
                          {t('organizer.shell.eventSwitcher.noEvents')}
                        </p>
                      )
                    ) : (
                      events.map((ev) => (
                        <button
                          key={ev.id}
                          type="button"
                          role="menuitem"
                          onClick={() => handlePickEvent(ev.id)}
                          className={[
                            'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors',
                            ev.id === selectedEventId
                              ? 'bg-red-800/70 text-white'
                              : 'text-slate-200 hover:bg-white/10',
                          ].join(' ')}
                        >
                          <span className="truncate">{ev.name}</span>
                          {ev.status === 'running' && (
                            <span className="shrink-0 rounded bg-red-700/30 px-1 py-px text-[10px] font-bold text-amber-300">
                              LIVE
                            </span>
                          )}
                        </button>
                      ))
                    )}
                    <div className="my-1 border-t border-slate-700" />
                    <Link
                      role="menuitem"
                      href={`/org/${slug}/events`}
                      onClick={() => setSwitcherOpen(false)}
                      className="block px-3 py-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white"
                    >
                      {t('organizer.shell.eventSwitcher.manageAll')}
                    </Link>
                  </div>
                )}
              </div>
            ) : (
              <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                {section.title}
              </p>
            )}
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
          {orgLogoUrl ? (
            /* Org-uploaded logo (R4). next/image needs every remote host pre-
               configured, which is heavier for arbitrary Supabase storage
               URLs — use a plain <img> here. */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={orgLogoUrl}
              alt=""
              width={44}
              height={44}
              onError={() => console.warn('[org-logo] sidebar failed to render', orgLogoUrl)}
              onLoad={() => console.debug('[org-logo] sidebar rendered', orgLogoUrl)}
              className="h-11 w-11 rounded-md object-cover"
            />
          ) : (
            <Image
              src="/brand/Logomini_nobackground.png"
              alt=""
              width={44}
              height={44}
              className="h-11 w-11"
              priority
            />
          )}
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-medium tracking-wide">
              {orgName || t('organizer.shell.brand')}
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
                {urlEventId ? t('organizer.shell.eventEyebrow') : t('organizer.shell.eyebrow')}
              </p>
              <p className="truncate font-display text-base font-medium tracking-tight text-slate-900 sm:text-lg">
                {urlEventId
                  ? t('organizer.shell.eventTitle', {
                      event: currentEvent?.name || urlEventId,
                    })
                  : t('organizer.shell.title', { organization: orgName || slug })}
              </p>
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
