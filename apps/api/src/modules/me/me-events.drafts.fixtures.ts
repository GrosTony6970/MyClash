/**
 * Léa's rows for the draft-bar tests of `GET /me/events` and `/me/upcoming` (ruling 164), split
 * out when one test file reached the 400-line cap. Test-only: it imports vitest.
 *
 * Three Events of club org-a: the public Spring Open (the public Sabre Cup, the draft Longsword
 * Open), the draft Autumn Cup (its Tournament published), and the public Winter Games, where Léa is
 * entered only in the draft Winter Secret. She runs another club, org-b.
 */
import { vi } from 'vitest';
import type { mockSupabase, TableSeed } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { MeController } from './me.controller';
import { MeEventsService } from './me-events.service';

const eventRow = (id: string, slug: string, name: string, status: string, startDate: string) => ({
  id,
  slug,
  name,
  start_date: startDate,
  end_date: startDate,
  status,
  timezone: 'Europe/Paris',
  event_kind: 'standard',
  organization_id: 'org-a',
});
export const SPRING = eventRow('e-pub', 'spring-open', 'Spring Open', 'published', '2027-04-10');
export const AUTUMN = eventRow('e-draft', 'autumn-cup', 'Autumn Cup', 'draft', '2027-10-02');
export const WINTER = eventRow('e-only', 'winter-games', 'Winter Games', 'published', '2027-01-15');

const tournament = (id: string, eventId: string, name: string, status: string) => ({
  id,
  event_id: eventId,
  slug: id,
  name,
  weapon: 'longsword',
  status,
});
export const SABRE = tournament('t-sabre', 'e-pub', 'Sabre Cup', 'published');
const LONGSWORD = tournament('t-long', 'e-pub', 'Longsword Open', 'draft');
const AUTUMN_OPEN = tournament('t-autumn', 'e-draft', 'Autumn Longsword', 'published');
const WINTER_RAPIER = tournament('t-winter', 'e-only', 'Winter Rapier', 'published');
const WINTER_SECRET = tournament('t-winter-secret', 'e-only', 'Winter Secret', 'draft');

/** Léa's roster rows, one per Event, all claimed by her account. */
export const lea = (id: string, event: { id: string }) => ({
  id,
  event_id: event.id,
  global_person_id: 'gp-lea',
  claimed_by_user_id: 'u-lea',
  events: event,
});
export const entry = (id: string, personId: string, tournamentId: string, seed: number) => ({
  id,
  person_id: personId,
  tournament_id: tournamentId,
  status: 'registered',
  seed,
  bib_number: seed + 10,
});
const bout = (id: string, red: string) => ({
  id,
  red_registration_id: red,
  blue_registration_id: 'r-someone',
});

/** One of her referee duties: a piste duty, or a Pool duty when `pool` is given. */
export const duty = (id: string, event: { id: string }, pool: object | null) => ({
  id,
  role: null,
  event_id: event.id,
  person_id: 'gp-lea',
  pool_id: pool ? `pool-${id}` : null,
  match_id: null,
  events: event,
  pools: pool,
  matches: null,
  lices: pool ? null : { name: 'Piste 1', venues: { name: 'Main hall' } },
});
export const LONGSWORD_POOL = {
  name: 'Pool A',
  phases: {
    type: 'pool',
    config_json: null,
    tournaments: { id: 't-long', name: 'Longsword Open' },
  },
};

export type Tables = Record<string, TableSeed>;

export function baseTables(): Tables {
  return {
    events: { rows: [SPRING, AUTUMN, WINTER] },
    tournaments: { rows: [SABRE, LONGSWORD, AUTUMN_OPEN, WINTER_RAPIER, WINTER_SECRET] },
    persons: { rows: [lea('p-pub', SPRING), lea('p-draft', AUTUMN), lea('p-only', WINTER)] },
    global_persons: { rows: [{ id: 'gp-lea', claimed_by_user_id: 'u-lea' }] },
    registrations: {
      rows: [
        entry('r-sabre', 'p-pub', 't-sabre', 3),
        entry('r-long', 'p-pub', 't-long', 1),
        entry('r-autumn', 'p-draft', 't-autumn', 2),
        entry('r-winter-secret', 'p-only', 't-winter-secret', 4),
      ],
    },
    matches: {
      rows: [bout('m-sabre', 'r-sabre'), bout('m-long', 'r-long'), bout('m-autumn', 'r-autumn')],
    },
    pool_members: { rows: [] },
    phases: { rows: [] },
    referee_assignments: {
      rows: [
        duty('d-lice', SPRING, null),
        duty('d-long', SPRING, LONGSWORD_POOL),
        duty('d-autumn', AUTUMN, null),
      ],
    },
    workshop_enrollments: { rows: [] },
    event_instructors: { rows: [{ person_id: 'gp-lea', event_id: 'e-draft', events: AUTUMN }] },
    workshop_instructors: { rows: [] },
    event_referees: { rows: [] },
    organization_members: {
      rows: [
        { organization_id: 'org-a', user_id: 'u-clubmate', role: 'read_only' },
        // Léa runs another club: that makes her no insider of this one.
        { organization_id: 'org-b', user_id: 'u-lea', role: 'owner' },
      ],
    },
    event_staff_accounts: {
      rows: [
        { id: 'staff-pub', event_id: 'e-pub', status: 'active' },
        { id: 'staff-off', event_id: 'e-pub', status: 'disabled' },
        { id: 'staff-draft', event_id: 'e-draft', status: 'active' },
      ],
    },
  };
}

/** The same rows, with Léa a member of org-a. */
export function clubMember(): Tables {
  const tables = baseTables();
  tables['organization_members'] = {
    rows: [{ organization_id: 'org-a', user_id: 'u-lea', role: 'read_only' }],
  };
  return tables;
}

/**
 * What the real `getSchedule` answers: her bouts in a published Tournament only, whatever the
 * Event's status — the Sabre Cup and the Autumn Longsword, never the Winter Secret.
 */
export function scheduleDouble() {
  return vi.fn(async (eventId: string) => ({
    matches: ['e-pub', 'e-draft'].includes(eventId)
      ? [
          {
            id: `bout-${eventId}`,
            scheduledAt: '2027-04-10T09:00:00.000Z',
            matchNumberLabel: 'M1',
            tournamentName: null,
            poolName: null,
            liceName: null,
            opponentName: null,
            isRed: true,
          },
        ]
      : [],
    refereeSlots: [],
  }));
}

/** The controller over `db`, signed in as Léa, with the real membership and staff checks. */
export function meController(
  db: ReturnType<typeof mockSupabase>,
  getSchedule: ReturnType<typeof scheduleDouble>,
) {
  const supabase = { service: db.service, getAuthUser: vi.fn(async () => ({ id: 'u-lea' })) };
  const orgs = new OrganizationsService(supabase as never);
  return new MeController(
    new MeEventsService(supabase as never, { getSchedule } as never, orgs),
    supabase as never,
  );
}

export const signedIn = { headers: { authorization: 'Bearer token' } };
export const withStaff = (staffId: string, eventId: string) => ({
  ...signedIn,
  staffSession: { staffId, eventId },
});
