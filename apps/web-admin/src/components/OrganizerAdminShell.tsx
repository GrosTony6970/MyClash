'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavIcon, useFocusTrap, type NavIconName } from '@myclash/ui';
import { useI18n } from '../i18n/I18nProvider';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher';
import { useOrganizerSelectedEvent } from './organizer-event-context';
import { resolveAuthDecision } from './organizer-auth-decision';
import { pickActiveHref } from './pick-active-href';
import { EVENT_NAV_GROUPS, EVENT_NAV_OVERVIEW, useEventNavGroups } from './event-nav-groups';
import { getPublicApiUrl } from '../lib/api-url';

const orgNavItems = [
  // `exact` so the org Overview (root) doesn't prefix-match and stay
  // highlighted on every `/org/{slug}/...` sub-route (incl. event pages).
  { href: '', labelKey: 'organizer.shell.nav.overview', icon: 'overview', exact: true },
  // `exact` prevents the events list from staying highlighted once
  // the operator drills into an event — sub-routes
  // `/org/{slug}/events/{eventId}/...` belong to the Event section.
  { href: 'events', labelKey: 'organizer.shell.nav.events', icon: 'events', exact: true },
  // Single "Rulesets" entry — the page redirects to /scoring and the
  // RulesetsTopNav pill at the top of each tab handles Scoring | Penalty
  // switching. pickActiveHref() uses startsWith() so the link stays
  // highlighted whether the operator is on /scoring or /penalty.
  { href: 'rulesets', labelKey: 'organizer.shell.nav.rulesets', icon: 'rulesets' },
  // Org-level league management (approve requests, groups, ruleset, roles) for
  // leagues this org administers. `exact: false` so per-league sub-routes
  // (`/org/{slug}/leagues/{leagueId}`) keep the entry highlighted.
  { href: 'leagues', labelKey: 'organizer.shell.nav.leagues', icon: 'leagues' },
  // Org profile + members self-service (name/logo/contact, add/remove
  // members) — before this entry only super-admins could edit an org.
  // pickActiveHref longest-match keeps it distinct from settings/ai.
  // `members`, not a settings cog: the route is /settings but the entry the
  // operator reads is "Org Members" — the org profile + member list. The
  // "Org" prefix keeps it distinct from the event-scoped people under PEOPLE.
  { href: 'settings', labelKey: 'organizer.shell.nav.orgSettings', icon: 'members' },
  { href: 'settings/ai', labelKey: 'organizer.shell.nav.aiSettings', icon: 'ai' },
  // Compensation is unified under each event (Compensation plan + Referee
  // compensation tabs); no standalone org-settings entry.
  // Venues are org-level — operators manage the catalogue from this
  // entry. The event sidebar no longer surfaces venues; the
  // workshop + session venue pickers consume the org catalogue
  // directly.
  { href: 'venues', labelKey: 'organizer.shell.nav.venues', icon: 'venues' },
] as const;

// Flat list of every event-scoped nav item (overview + all themed groups).
// The themed grouping itself lives in ./event-nav-groups; this derived list
// drives active-link detection (pickActiveHref, longest-match across groups).
const eventNavItems = [EVENT_NAV_OVERVIEW, ...EVENT_NAV_GROUPS.flatMap((g) => g.items)] as const;

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
  const apiUrl = getPublicApiUrl();

  // Event context — provides selectedEventId (URL > localStorage > auto-pick),
  // the full event list for the switcher, and orgName for the brand block.
  const { orgName, orgLogoUrl, events, eventsError, selectedEventId, currentEvent, selectEvent } =
    useOrganizerSelectedEvent();

  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  // Personal league grants only. Org-managed leagues already have a home under
  // this org's own Leagues entry, so offering /leagues for those would just be
  // a second door to the same room.
  const [hasLeagueRoles, setHasLeagueRoles] = useState(false);
  // Super-admins are allowed into any org (see organizer-auth-decision) — surface
  // a "Platform admin" link so the dual-role operator can jump back to /admin.
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
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
        const data = (await res.json()) as Parameters<typeof resolveAuthDecision>[1] & {
          user?: { email?: string };
        };
        setHasLeagueRoles(Boolean(data?.admin?.hasLeagueRoles));
        setIsSuperAdmin(Boolean(data?.admin?.isSuperAdmin));
        setEmail(data?.user?.email ?? null);
        const decision = resolveAuthDecision(slug, data);
        if (decision.kind === 'unauthenticated') {
          window.location.replace('/login');
        } else if (decision.kind === 'no_access') {
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
  const eventGroups = useEventNavGroups();
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
              // Ungrouped overview pinned under the event switcher.
              overview: {
                ...EVENT_NAV_OVERVIEW,
                href: joinPath(eventBase, EVENT_NAV_OVERVIEW.href),
              },
              // Themed collapsible groups.
              groups: EVENT_NAV_GROUPS.map((group) => ({
                key: group.key,
                headingKey: group.headingKey,
                items: group.items.map((item) => ({
                  ...item,
                  href: joinPath(eventBase, item.href),
                })),
              })),
              // Flat resolved list for active-link detection across all groups.
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

  const renderNavItem = (
    item: { href: string; labelKey: string; icon: NavIconName },
    activeHref: string | null,
  ) => {
    const active = item.href === activeHref;
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
        <NavIcon name={item.icon} />
        <span>{t(item.labelKey)}</span>
      </Link>
    );
  };

  const sidebar = (
    <nav aria-label={t('organizer.shell.navigationLabel')} className="flex flex-col gap-6">
      {navSections.map((section, idx) => {
        const activeHref = pickActiveHref(pathname, section.items);
        const isEventSection = section.key === 'event';
        return (
          <div key={section.key} className={idx === 0 ? '' : 'border-t border-border pt-5'}>
            {isEventSection ? (
              <div className="relative mb-3 px-2" ref={switcherRef}>
                <button
                  type="button"
                  onClick={() => setSwitcherOpen((v) => !v)}
                  className="flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left transition-colors hover:bg-foreground/5"
                  aria-haspopup="menu"
                  aria-expanded={switcherOpen}
                  aria-label={t('organizer.shell.eventSwitcher.openLabel')}
                >
                  <span className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
                    <span>{section.title}</span>
                    <span aria-hidden="true" className="shrink-0 text-muted">
                      {switcherOpen ? '▴' : '▾'}
                    </span>
                  </span>
                  {currentEvent ? (
                    <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <span className="min-w-0 truncate">{currentEvent.name}</span>
                      {currentEvent.status === 'running' && (
                        <span className="shrink-0 rounded bg-danger/30 px-1 py-px text-[10px] font-bold text-danger">
                          LIVE
                        </span>
                      )}
                    </span>
                  ) : null}
                </button>
                {switcherOpen && (
                  <div
                    role="menu"
                    className="absolute left-2 right-2 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-xl"
                  >
                    {events.length === 0 ? (
                      eventsError ? (
                        <p role="alert" className="px-3 py-2 text-xs font-medium text-danger">
                          {t('organizer.shell.eventSwitcher.loadFailed')} ({eventsError})
                        </p>
                      ) : (
                        <p className="px-3 py-2 text-sm italic text-muted">
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
                              ? 'bg-accent/70 text-accent-foreground'
                              : 'text-foreground hover:bg-foreground/10',
                          ].join(' ')}
                        >
                          <span className="truncate">{ev.name}</span>
                          {ev.status === 'running' && (
                            <span className="shrink-0 rounded bg-danger/30 px-1 py-px text-[10px] font-bold text-gold">
                              LIVE
                            </span>
                          )}
                        </button>
                      ))
                    )}
                    <div className="my-1 border-t border-border" />
                    <Link
                      role="menuitem"
                      href={`/org/${slug}/events`}
                      onClick={() => setSwitcherOpen(false)}
                      className="block px-3 py-2 text-sm text-muted hover:bg-foreground/10 hover:text-foreground"
                    >
                      {t('organizer.shell.eventSwitcher.manageAll')}
                    </Link>
                  </div>
                )}
              </div>
            ) : (
              <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-muted">
                {section.title}
              </p>
            )}
            {section.key === 'event' ? (
              <>
                <div className="flex flex-col gap-1">
                  {renderNavItem(section.overview, activeHref)}
                </div>
                <div className="mt-4 flex flex-col gap-4">
                  {section.groups.map((group) => {
                    const groupOpen = eventGroups.isOpen(group.key);
                    const groupHasActive = group.items.some((it) => it.href === activeHref);
                    const groupPanelId = `nav-group-${group.key}`;
                    return (
                      <div key={group.key}>
                        <button
                          type="button"
                          onClick={() => eventGroups.toggle(group.key)}
                          aria-expanded={groupOpen}
                          aria-controls={groupPanelId}
                          className={[
                            'flex w-full items-center justify-between gap-2 rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors',
                            !groupOpen && groupHasActive
                              ? 'text-foreground'
                              : 'text-muted hover:text-foreground',
                          ].join(' ')}
                        >
                          <span>{t(group.headingKey)}</span>
                          <span aria-hidden="true" className="shrink-0 text-muted">
                            {groupOpen ? '▾' : '▸'}
                          </span>
                        </button>
                        {groupOpen && (
                          <div id={groupPanelId} className="mt-1 flex flex-col gap-1">
                            {group.items.map((item) => renderNavItem(item, activeHref))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-1">
                {section.items.map((item) => renderNavItem(item, activeHref))}
              </div>
            )}
          </div>
        );
      })}

      {/*
        Rendered OUTSIDE orgNavItems on purpose. That array is mapped through
        joinPath(orgBase, href), which strips a leading slash — so '/leagues'
        would silently become '/org/{slug}/leagues', an existing valid route
        that is the very surface this entry exists to bypass. It would not 404
        and would not error; only a manual click would ever catch it.
      */}
      {hasLeagueRoles && (
        <div className="border-t border-border pt-5">
          <div className="flex flex-col gap-1">
            {renderNavItem(
              { href: '/leagues', labelKey: 'organizer.shell.nav.myLeagues', icon: 'leagues' },
              pickActiveHref(pathname, [{ href: '/leagues' }]),
            )}
          </div>
        </div>
      )}

      {/*
        Same rationale as the /leagues entry above: an absolute '/admin' href
        kept OUTSIDE orgNavItems so joinPath can't rewrite it into
        '/org/{slug}/admin'. Only shown to super-admins, the workspace switch
        back to the platform console.
      */}
      {isSuperAdmin && (
        <div className="border-t border-border pt-5">
          <div className="flex flex-col gap-1">
            {renderNavItem(
              {
                href: '/admin',
                labelKey: 'organizer.shell.nav.platformAdmin',
                icon: 'switchWorkspace',
              },
              pickActiveHref(pathname, [{ href: '/admin' }]),
            )}
          </div>
        </div>
      )}
    </nav>
  );

  const logoutAction = (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-md border border-border bg-background/40 px-3 py-2 text-left text-sm font-semibold text-foreground transition-colors hover:border-danger/60 hover:bg-danger/15 hover:text-foreground disabled:cursor-wait disabled:opacity-70"
      aria-label={t('organizer.shell.logoutAriaLabel')}
      disabled={loggingOut}
      onClick={() => {
        void handleLogout();
      }}
    >
      <NavIcon name="logout" />
      <span>{loggingOut ? t('organizer.shell.loggingOut') : t('organizer.shell.logout')}</span>
    </button>
  );

  const accountFooter = email ? (
    <div className="px-3">
      <p className="text-[0.7rem] text-muted">{t('organizer.shell.loggedAs')}</p>
      <p className="truncate text-xs font-semibold text-foreground" title={email}>
        {email}
      </p>
    </div>
  ) : null;

  // Flex row with STICKY chrome, not fixed. Fixed chrome ignores document flow,
  // so anything the root layout renders above this shell (the maintenance
  // banner, the legal-update banner) ends up painted over by the header and the
  // sidebar. Sticky keeps the same pinned-on-scroll feel while letting a banner
  // of any height push the whole shell down.
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-skip-link focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-foreground"
      >
        {t('organizer.shell.skipToContent')}
      </a>

      {/* `shrink-0` keeps the 288px rail from being squeezed by the flex row;
          `h-screen` (rather than the stretch height a flex item would take) is
          what gives the sticky element room to travel. */}
      <aside
        data-theme="dark"
        className="sticky top-0 z-sidebar hidden h-screen w-72 shrink-0 flex-col border-r border-border bg-background px-4 py-5 text-foreground lg:flex"
      >
        {/* Three-slot brand row: MyClash logo (always) + org name + org
            logo (when uploaded, as a secondary identity badge to the
            right of the name). The MyClash mark is the persistent home
            affordance; the org logo never replaces it. */}
        <Link href={orgBase} className="mb-7 flex items-center gap-3">
          <Image
            src="/brand/Logomini_nobackground.png"
            alt=""
            width={44}
            height={44}
            className="h-11 w-11 shrink-0"
            priority
          />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-lg font-medium tracking-wide">
              {orgName || t('organizer.shell.brand')}
            </p>
          </div>
          {orgLogoUrl && (
            /* Org-uploaded logo. next/image needs every remote host pre-
               configured, which is heavier for arbitrary Supabase storage
               URLs — use a plain <img> here. */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={orgLogoUrl}
              alt=""
              width={32}
              height={32}
              onError={() => console.warn('[org-logo] sidebar failed to render', orgLogoUrl)}
              className="h-8 w-8 shrink-0 rounded-md object-cover"
            />
          )}
        </Link>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">{sidebar}</div>
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
          {accountFooter}
          <LanguageSwitcher className="px-3" />
          {logoutAction}
        </div>
      </aside>

      {/* Right column. `min-w-0` is mandatory: without it a long event name or
          the schedule grid blows the flex column out and breaks every truncate
          below it. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-header border-b border-border bg-background/90 backdrop-blur">
          <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border text-foreground lg:hidden"
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
                <p className="text-xs font-semibold uppercase tracking-wider text-accent">
                  {urlEventId ? t('organizer.shell.eventEyebrow') : t('organizer.shell.eyebrow')}
                </p>
                <p className="truncate font-display text-base font-medium tracking-tight text-foreground sm:text-lg">
                  {urlEventId
                    ? t('organizer.shell.eventTitle', {
                        event: currentEvent?.name || urlEventId,
                      })
                    : t('organizer.shell.title', { organization: orgName || slug })}
                </p>
              </div>
            </div>
            <div className="hidden items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-muted sm:flex">
              <span className="h-2 w-2 rounded-full bg-danger" aria-hidden="true" />
              {t('organizer.shell.status')}
            </div>
          </div>
        </header>

        {open && (
          <div className="fixed inset-0 z-overlay lg:hidden">
            <button
              type="button"
              aria-label={t('organizer.shell.closeMenu')}
              className="absolute inset-0 bg-slate-950/40"
              onClick={() => setOpen(false)}
            />
            <div
              ref={drawerRef}
              data-theme="dark"
              role="dialog"
              aria-modal="true"
              aria-label={t('organizer.shell.navigationLabel')}
              className="relative flex h-full w-80 max-w-[85vw] flex-col bg-background px-4 py-5 text-foreground shadow-2xl"
            >
              <div className="mb-6 flex items-center justify-between">
                <Link
                  href={orgBase}
                  className="flex min-w-0 flex-1 items-center gap-3"
                  onClick={() => setOpen(false)}
                >
                  <Image
                    src="/brand/Logomini_nobackground.png"
                    alt=""
                    width={40}
                    height={40}
                    className="shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate font-display text-lg font-medium">
                    {orgName || t('organizer.shell.brand')}
                  </span>
                  {orgLogoUrl && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={orgLogoUrl}
                      alt=""
                      width={28}
                      height={28}
                      onError={() => console.warn('[org-logo] drawer failed to render', orgLogoUrl)}
                      className="h-7 w-7 shrink-0 rounded-md object-cover"
                    />
                  )}
                </Link>
                <button
                  type="button"
                  className="rounded-md border border-border px-3 py-1 text-sm text-foreground"
                  onClick={() => setOpen(false)}
                >
                  {t('organizer.shell.close')}
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">{sidebar}</div>
              <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
                {accountFooter}
                <LanguageSwitcher className="px-3" />
                {logoutAction}
              </div>
            </div>
          </div>
        )}

        <div id="main-content" className="flex-1">
          {children}
        </div>
      </div>
    </div>
  );
}
