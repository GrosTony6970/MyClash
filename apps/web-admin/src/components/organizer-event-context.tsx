'use client';

/**
 * OrganizerEventContext
 *
 * Holds the "currently selected event" for an organizer's session, separate
 * from the URL. The URL still wins when it carries an `eventId` segment (the
 * canonical source of truth on event-scoped routes), but on org-scoped
 * routes — /org/[slug]/penalty-rulesets, /org/[slug]/settings/* — the URL
 * has no eventId and the context picks up the slack so the Event nav
 * section stays visible and the switcher keeps a current selection.
 *
 * Persistence: `localStorage` keyed per org slug
 * (`myclash.organizer.selectedEvent.{slug}`). This survives hard refreshes
 * and across logins on the same browser.
 *
 * Resolution priority:
 *   1. URL eventId (if present) → wins, and writes through to localStorage.
 *   2. localStorage (when the stored id matches one of the org's events).
 *   3. Auto-pick from the org's events:
 *        - status='running' (live) → top priority.
 *        - status='published' AND start_date >= now → soonest first.
 *        - else first event (events come back start_date DESC).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useI18n } from '../i18n/I18nProvider';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

export interface OrgEventSummary {
  id: string;
  name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
}

interface OrganizerEventContextValue {
  orgId: string | null;
  orgSlug: string;
  orgName: string | null;
  orgLogoUrl: string | null;
  events: OrgEventSummary[];
  /**
   * Non-null when the most recent events-list fetch failed. The shell
   * surfaces this inline in the picker so a 403/500/offline run isn't
   * silently rendered as "no events".
   */
  eventsError: string | null;
  selectedEventId: string | null;
  currentEvent: OrgEventSummary | null;
  selectEvent: (id: string) => void;
  /**
   * Re-fetch the org metadata (name, logo). Used by pages that mutate the
   * org from outside the context — without this, the shell keeps showing
   * the stale name / logo until the next provider mount (logout/login).
   */
  refetchOrg: () => Promise<void>;
  /**
   * Re-fetch the org's events list. Call this after creating, renaming,
   * or deleting an event so the picker reflects the change without a
   * hard refresh. Mirrors the refetchOrg pattern.
   */
  refetchEvents: () => Promise<void>;
}

const OrganizerEventContext = createContext<OrganizerEventContextValue | null>(null);

function storageKey(slug: string): string {
  return `myclash.organizer.selectedEvent.${slug}`;
}

export function pickAutoEvent(events: readonly OrgEventSummary[]): OrgEventSummary | null {
  const live = events.find((e) => e.status === 'running');
  if (live) return live;
  const now = Date.now();
  const upcoming = events
    .filter((e) => e.status === 'published' && e.start_date && Date.parse(e.start_date) >= now)
    .sort((a, b) => Date.parse(a.start_date!) - Date.parse(b.start_date!))[0];
  if (upcoming) return upcoming;
  return events[0] ?? null;
}

export function OrganizerEventContextProvider({
  slug,
  urlEventId,
  children,
}: {
  slug: string;
  urlEventId: string | null;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [orgLogoUrl, setOrgLogoUrl] = useState<string | null>(null);
  const [events, setEvents] = useState<OrgEventSummary[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventIdState] = useState<string | null>(null);

  // Resolve orgId + orgName + orgLogoUrl from slug. Mirrors the lookup the
  // shell did previously; centralising it here so every org-scoped page can
  // read org branding from the same source.
  //
  // Exposed as `refetchOrg` so write-side pages (rename, logo upload) can
  // invalidate this snapshot without remounting the provider — the alternative
  // was relying on logout/login to re-fetch, which is what the user actually
  // observed in the wild before this helper existed.
  const refetchOrg = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      if (!slug) return;
      try {
        const res = await fetch(`${apiUrl}/api/v1/organizations/slug/${encodeURIComponent(slug)}`, {
          credentials: 'include',
          ...(signal ? { signal } : {}),
        });
        if (!res.ok) return;
        const raw = (await res.json()) as Record<string, unknown>;
        if (typeof raw['id'] === 'string') setOrgId(raw['id']);
        if (typeof raw['name'] === 'string') setOrgName(raw['name']);
        const logo = raw['logo_url'] ?? raw['logoUrl'];
        if (typeof logo === 'string') setOrgLogoUrl(logo);
        else setOrgLogoUrl(null);
      } catch {
        // Swallow — caller is a fire-and-forget invalidation; the next render
        // already shows whatever stale value we have, which is no worse than
        // before this call.
      }
    },
    [slug],
  );

  useEffect(() => {
    if (!slug) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async org fetch; setState runs after the awaited request, not synchronously
    void refetchOrg(controller.signal);
    return () => controller.abort();
  }, [slug, refetchOrg]);

  // Fetch the org's events for the switcher + auto-pick logic. We always
  // want the list available so the inline switcher can show options on
  // any route, not just event-scoped ones.
  //
  // Exposed as `refetchEvents` so write-side pages (create, delete,
  // rename) can invalidate the snapshot without remounting the
  // provider — without this hook a freshly-created event stayed
  // invisible in the picker until the next hard refresh / login.
  //
  // Non-200s and network errors now surface via `eventsError` instead
  // of being silently swallowed. The shell renders the error inline so
  // the next 403/500 is debuggable rather than ambiguous-empty.
  const refetchEvents = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      if (!orgId) return;
      try {
        const res = await fetch(`${apiUrl}/api/v1/organizations/${orgId}/events`, {
          credentials: 'include',
          ...(signal ? { signal } : {}),
        });
        if (!res.ok) {
          setEventsError(`${res.status} ${res.statusText || t('admin.common.requestFailed')}`);
          return;
        }
        const data = (await res.json()) as OrgEventSummary[];
        setEvents(data ?? []);
        setEventsError(null);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setEventsError(err instanceof Error ? err.message : t('admin.common.loadEventsFailed'));
      }
    },
    [orgId, t],
  );

  useEffect(() => {
    if (!orgId) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async events fetch; setState runs after the awaited request, not synchronously
    void refetchEvents(controller.signal);
    return () => controller.abort();
  }, [orgId, refetchEvents]);

  // Resolve selectedEventId following the priority chain:
  //   URL eventId → localStorage → auto-pick from events.
  // The URL value overwrites localStorage so refreshing on a deep event
  // route updates "last seen" for next non-event nav.
  useEffect(() => {
    if (urlEventId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs selected event from the URL param into local state; behaviour-preserving
      setSelectedEventIdState(urlEventId);
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(storageKey(slug), urlEventId);
        } catch {
          // ignore storage failures (private mode, quota, etc)
        }
      }
      return;
    }
    if (typeof window !== 'undefined') {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(storageKey(slug));
      } catch {
        stored = null;
      }
      if (stored && events.some((e) => e.id === stored)) {
        setSelectedEventIdState(stored);
        return;
      }
    }
    if (events.length > 0) {
      const chosen = pickAutoEvent(events);
      if (chosen) setSelectedEventIdState(chosen.id);
    }
  }, [urlEventId, slug, events]);

  const selectEvent = useCallback(
    (id: string) => {
      setSelectedEventIdState(id);
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(storageKey(slug), id);
        } catch {
          // ignore
        }
      }
    },
    [slug],
  );

  const currentEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId],
  );

  const refetchOrgPublic = useCallback(async () => {
    await refetchOrg();
  }, [refetchOrg]);

  const refetchEventsPublic = useCallback(async () => {
    await refetchEvents();
  }, [refetchEvents]);

  const value = useMemo<OrganizerEventContextValue>(
    () => ({
      orgId,
      orgSlug: slug,
      orgName,
      orgLogoUrl,
      events,
      eventsError,
      selectedEventId,
      currentEvent,
      selectEvent,
      refetchOrg: refetchOrgPublic,
      refetchEvents: refetchEventsPublic,
    }),
    [
      orgId,
      slug,
      orgName,
      orgLogoUrl,
      events,
      eventsError,
      selectedEventId,
      currentEvent,
      selectEvent,
      refetchOrgPublic,
      refetchEventsPublic,
    ],
  );

  return <OrganizerEventContext.Provider value={value}>{children}</OrganizerEventContext.Provider>;
}

export function useOrganizerSelectedEvent(): OrganizerEventContextValue {
  const ctx = useContext(OrganizerEventContext);
  if (!ctx) {
    throw new Error('useOrganizerSelectedEvent must be used within OrganizerEventContextProvider');
  }
  return ctx;
}
