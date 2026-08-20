import { apiRequest, fetchMe } from '@myclash/api-client';
import { getPublicApiUrl } from './api-url';
/**
 * Compute where to send an organizer right after a successful auth.
 *
 * Today the API defaults `next` to `/dashboard`, which then makes the user
 * pick an org and event manually. Instead, after auth we resolve their
 * primary org and auto-pick a sensible event (live > upcoming > most
 * recent) so they land directly inside the event hub.
 *
 * Falls back to the provided `fallback` (defaults to `/dashboard`) when:
 *  - /api/v1/me fails or returns no claimed identity,
 *  - the user has no organization-membership role,
 *  - the org has no events (returns the org's events list page so the
 *    operator can create one).
 *
 * Safe to import from any client component.
 *
 * No try/catch: `apiRequest` never throws, so every failure arrives as a value
 * and lands on `fallback` by the same path an unhelpful answer does. The old
 * catch-all wrapped both reads and could not tell them apart.
 */

const apiUrl = getPublicApiUrl();

type OrgRole = 'owner' | 'admin' | 'scorekeeper' | 'viewer' | string;

interface EventRow {
  id: string;
  name: string;
  status: string;
  start_date: string | null;
}

function isManageableRole(role: OrgRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'scorekeeper';
}

function pickAutoEvent(events: readonly EventRow[]): EventRow | null {
  const live = events.find((e) => e.status === 'running');
  if (live) return live;
  const now = Date.now();
  const upcoming = events
    .filter((e) => e.status === 'published' && e.start_date && Date.parse(e.start_date) >= now)
    .sort((a, b) => Date.parse(a.start_date!) - Date.parse(b.start_date!))[0];
  if (upcoming) return upcoming;
  return events[0] ?? null;
}

export async function resolvePostAuthDestination(fallback = '/dashboard'): Promise<string> {
  const me = await fetchMe(apiUrl);
  if (!me.ok || me.data.type !== 'claimed') return fallback;

  const org = (me.data.admin?.organizations ?? []).find((o) => isManageableRole(o.role));
  if (!org) return fallback;

  const events = await apiRequest<EventRow[]>(apiUrl, `/api/v1/organizations/${org.id}/events`);
  if (!events.ok || !Array.isArray(events.data) || events.data.length === 0) {
    return `/org/${org.slug}/events`;
  }

  const chosen = pickAutoEvent(events.data);
  return chosen ? `/org/${org.slug}/events/${chosen.id}` : `/org/${org.slug}/events`;
}
