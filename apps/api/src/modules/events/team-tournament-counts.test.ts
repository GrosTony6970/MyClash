/**
 * A team Tournament's entrants are its teams, wherever an Event counts its entrants: the overview,
 * the readiness checklist, and the club's list of Events (`hasTeamTournament`, the "Teams" menu).
 *
 * The story: Lyon's Event holds "Longsword" (individual, 3 Fighters in, one waiting, one withdrawn,
 * a cap of 32) and "Team Longsword" (team, 3 teams, a cap of 8 teams). Another Event of the club
 * holds a team Tournament with a team of its own, which must count nowhere here.
 *
 * Simulated tables (`{ rows }`): the filters apply, so a read that forgot its scope counts the
 * other Event's team.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventsService } from './events.service';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  type TableSeed,
} from '../../common/testing/supabase-chain';

// The Workshop totals have reads and a test of their own (`workshop-totals.test.ts`).
vi.mock('./workshop-totals', () => ({
  readWorkshopTotals: vi.fn(() => Promise.resolve(null)),
}));

const assertOrgRole = vi.fn();

const TOURNAMENT_SELECT =
  'id, slug, name, status, color, ruleset_code, max_participants, max_waitlist, entrant_kind';

const tournament = (id: string, event_id: string, kind: string, max: number, sort: number) => ({
  id,
  event_id,
  slug: id,
  name: id,
  status: 'draft',
  color: null,
  ruleset_code: 'TF_v1',
  max_participants: max,
  max_waitlist: null,
  entrant_kind: kind,
  sort_order: sort,
});

const registration = (n: number, status: string) => ({
  id: `r${n}`,
  tournament_id: 't-ind',
  person_id: `p${n}`,
  status,
});

function seeded(tables: Record<string, TableSeed> = {}) {
  const db = mockSupabase({
    events: {
      rows: [
        { id: 'e1', organization_id: 'org-1', status: 'draft', created_at: '2026-11-02' },
        { id: 'e2', organization_id: 'org-1', status: 'draft', created_at: '2026-11-01' },
      ],
    },
    tournaments: {
      rows: [
        tournament('t-ind', 'e1', 'individual', 32, 1),
        tournament('t-team', 'e1', 'team', 8, 2),
        tournament('t-elsewhere', 'e2', 'team', 4, 1),
      ],
    },
    registrations: {
      rows: [
        registration(1, 'registered'),
        registration(2, 'registered'),
        registration(3, 'checked_in'),
        registration(4, 'waitlist'),
        registration(5, 'withdrawn'),
      ],
    },
    teams: {
      rows: [
        { id: 'tm1', tournament_id: 't-team' },
        { id: 'tm2', tournament_id: 't-team' },
        { id: 'tm3', tournament_id: 't-team' },
        { id: 'tm4', tournament_id: 't-elsewhere' },
      ],
    },
    persons: { rows: [] },
    referee_qualifications: { rows: [] },
    phases: { rows: [] },
    lices: { rows: [] },
    ...tables,
  });
  const service = new EventsService(
    db as never,
    { assertOrgRole } as never,
    {} as never,
    createRulesetRegistry(),
    undefined,
    {} as never,
  );
  return { db, service };
}

beforeEach(() => {
  vi.clearAllMocks();
  assertOrgRole.mockResolvedValue(undefined);
});

describe('the Event overview counts a team Tournament by its teams', () => {
  it('shows the teams against the cap of teams, and the Fighters against the cap of Fighters', async () => {
    const { db, service } = seeded();

    const stats = await service.getEventDashboardStats('e1', 'u1');

    expect(stats.tournaments).toMatchObject([
      { id: 't-ind', entrantKind: 'individual', entrantCount: 3, waitlistedCount: 1 },
      { id: 't-team', entrantKind: 'team', entrantCount: 3, maxParticipants: 8 },
    ]);
    // The total is shown against the Fighters registered: the cap of 8 teams is not in it.
    expect(stats.totals).toMatchObject({ registeredFighters: 3, maxParticipants: 32 });
    expect(selectsFor(db.from, 'tournaments')).toEqual([TOURNAMENT_SELECT]);
    expect(selectsFor(db.from, 'teams')).toEqual(['tournament_id']);
    expect(filtersFor(db.from, 'teams', 'in')).toEqual([['tournament_id', ['t-team']]]);
  });

  it('reads no team for an Event of individual Tournaments', async () => {
    const { db, service } = seeded({
      tournaments: { rows: [tournament('t-ind', 'e1', 'individual', 32, 1)] },
    });

    const stats = await service.getEventDashboardStats('e1', 'u1');

    expect(stats.tournaments).toMatchObject([{ id: 't-ind', entrantCount: 3 }]);
    expect(selectsFor(db.from, 'teams')).toEqual([]);
  });
});

describe('the readiness checklist counts a team Tournament by its teams', () => {
  it('checks the teams of a team Tournament, the Fighters of an individual one', async () => {
    const { db, service } = seeded();

    const { checks } = await service.getEventReadiness('e1', 'u1');

    const entrants = checks.filter((c) => c.key === 'teams' || c.key === 'fighters');
    expect(entrants).toEqual([
      { key: 'fighters', level: 'ok', values: { count: 3 }, tournamentId: 't-ind' },
      { key: 'teams', level: 'ok', values: { count: 3 }, tournamentId: 't-team' },
    ]);
    expect(selectsFor(db.from, 'tournaments')).toEqual([TOURNAMENT_SELECT]);
    expect(selectsFor(db.from, 'teams')).toEqual(['tournament_id']);
  });

  it('marks a team Tournament with one team blocking', async () => {
    const { service } = seeded({ teams: { rows: [{ id: 'tm1', tournament_id: 't-team' }] } });

    const { checks } = await service.getEventReadiness('e1', 'u1');

    expect(checks.find((c) => c.key === 'teams')).toMatchObject({
      level: 'critical',
      values: { count: 1 },
    });
  });
});

describe("the club's list of Events says which hold a team Tournament", () => {
  it('flags the Events with a team Tournament, in the one read of their Tournaments', async () => {
    const { db, service } = seeded({
      tournaments: {
        rows: [
          tournament('t-ind', 'e1', 'individual', 32, 1),
          tournament('t-elsewhere', 'e2', 'team', 4, 1),
        ],
      },
      registrations: { rows: [] },
    });

    const events = (await service.listOrgEvents('org-1', 'u1')) as Array<Record<string, unknown>>;

    expect(events.map((e) => [e['id'], e['hasTeamTournament']])).toEqual([
      ['e1', false],
      ['e2', true],
    ]);
    expect(selectsFor(db.from, 'tournaments')).toEqual(['id, event_id, entrant_kind']);
  });
});
