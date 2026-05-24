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
  events: OrgEventSummary[];
  selectedEventId: string | null;
  currentEvent: OrgEventSummary | null;
  selectEvent: (id: string) => void;
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
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [events, setEvents] = useState<OrgEventSummary[]>([]);
  const [selectedEventId, setSelectedEventIdState] = useState<string | null>(null);

  // Resolve orgId + orgName from slug. Mirrors the lookup the shell did
  // previously; centralising it here so every org-scoped page can read it.
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
        if (org.id) setOrgId(org.id);
        if (org.name) setOrgName(org.name);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [slug]);

  // Fetch the org's events for the switcher + auto-pick logic. We always
  // want the list available so the inline switcher can show options on
  // any route, not just event-scoped ones.
  useEffect(() => {
    if (!orgId) return;
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/organizations/${orgId}/events`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as OrgEventSummary[];
        setEvents(data ?? []);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [orgId]);

  // Resolve selectedEventId following the priority chain:
  //   URL eventId → localStorage → auto-pick from events.
  // The URL value overwrites localStorage so refreshing on a deep event
  // route updates "last seen" for next non-event nav.
  useEffect(() => {
    if (urlEventId) {
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

  const value = useMemo<OrganizerEventContextValue>(
    () => ({
      orgId,
      orgSlug: slug,
      orgName,
      events,
      selectedEventId,
      currentEvent,
      selectEvent,
    }),
    [orgId, slug, orgName, events, selectedEventId, currentEvent, selectEvent],
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
