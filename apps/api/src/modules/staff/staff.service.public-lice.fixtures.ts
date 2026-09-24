// Seeded pistes, bouts and builders for the public piste board tests, split out
// when staff.service.public-lice.test.ts reached the 400-line cap. It imports
// the Supabase double (vitest), so it is named in tsconfig.build.json's exclude
// list.
//
// Two test files share it: staff.service.public-lice.test.ts (which piste a URL
// name finds) and staff.service.public-lice-hidden.test.ts (what the board hides
// from the public, and when it tells its screen to poll: rulings 81-83, 89, 92).

import { StaffService } from './staff.service';
import { StaffController } from './staff.controller';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';

export const EVENT = 'event-1';
export const OTHER_EVENT = 'event-2';
export const LICE = 'lice-1';
/** Ties `LICE` on `sort_order` and sorts before it on `id`, so dropping the
 * event scope hands this row the answer. */
export const OTHER_LICE = 'lice-0';

export const eventRow = (id: string) => ({
  id,
  organization_id: 'org-1',
  slug: `slug-${id}`,
  name: `Event ${id}`,
  status: 'running',
  start_date: '2026-08-08',
  end_date: '2099-12-31',
});

/**
 * A piste row carrying its own event embed, because `getCurrentForLiceId`
 * reads `events(...)` off it and a seeded table returns rows, not joins.
 */
export const liceRow = (id: string, name: string, eventId: string, sortOrder: number) => ({
  id,
  name,
  event_id: eventId,
  sort_order: sortOrder,
  events: { id: eventId, slug: `slug-${eventId}`, name: `Event ${eventId}`, status: 'running' },
});

/** A Tournament of an Event, for the board's poll mark (ruling 92). */
export const tournamentRow = (id: string, eventId: string, status: string) => ({
  id,
  event_id: eventId,
  status,
});

/** Every Tournament of `EVENT` public: nothing on it hides from the public. */
export const PUBLIC_TOURNAMENTS = [
  tournamentRow('t-running', EVENT, 'running'),
  tournamentRow('t-published', EVENT, 'published'),
  tournamentRow('t-completed', EVENT, 'completed'),
];

export const DEFAULT_LICES = [
  liceRow(OTHER_LICE, 'Piste 1', OTHER_EVENT, 0),
  liceRow(LICE, 'Piste 1', EVENT, 0),
  liceRow('lice-2', 'Piste 2', EVENT, 1),
  // Folds to `Piste 1` under any rule wider than trim, and sorts after it, so a
  // fold that strips inner whitespace would answer for this piste with LICE.
  liceRow('lice-3', 'Piste1', EVENT, 2),
  // A name that IS a percent-escape, and one holding a bare `%`. Both are legal
  // TEXT, and both are what a second decode of the URL segment destroys.
  liceRow('lice-esc', 'Piste%201', EVENT, 3),
  liceRow('lice-pct', '100% Cotton', EVENT, 4),
];

/** A bout on a piste, with the Tournament and Event its visibility is read from. */
export const bout = (
  id: string,
  status: string,
  scheduledAt: string,
  tournamentStatus = 'running',
  event: { id: string; status: string } = { id: EVENT, status: 'running' },
) => ({
  id,
  lice_id: LICE,
  status,
  scheduled_at: scheduledAt,
  phases: {
    tournaments: {
      status: tournamentStatus,
      events: { ...event, organization_id: 'org-1' },
    },
  },
  // The flat key a dotted filter reads on a seeded row (`onlyPublicTournaments`).
  'phases.tournaments.status': tournamentStatus,
});

export const RUNNING_ON_LICE = [bout('match-here', 'running', '2026-08-08T09:00:00Z')];

/** No login, no staff cookie: the hall projector. */
export const ANON = { userId: 'anonymous', staff: null };
export const ANON_REQ = { headers: {}, cookies: {}, identity: { kind: 'anonymous' } } as never;

export function build(
  matches: Array<Record<string, unknown>> = [],
  lices: Array<Record<string, unknown>> = DEFAULT_LICES,
  events: Array<Record<string, unknown>> = [eventRow(OTHER_EVENT), eventRow(EVENT)],
  tournaments: Array<Record<string, unknown>> = PUBLIC_TOURNAMENTS,
) {
  const supabase = mockSupabase({
    events: { rows: events },
    lices: { rows: lices },
    matches: { rows: matches },
    tournaments: { rows: tournaments },
    organization_members: {
      rows: [{ organization_id: 'org-1', user_id: 'u-member', role: 'read_only' }],
    },
    event_staff_accounts: { rows: [{ id: 'staff-1', event_id: EVENT, status: 'active' }] },
  });
  const orgs = new OrganizationsService(supabase as never);
  const service = new StaffService(supabase as never, orgs, {} as never, {} as never);
  const controller = new StaffController(service, supabase as never, orgs);
  return { service, controller, supabase };
}

export type LiceCurrent = { liceId: string; current: { id: string } | null };
