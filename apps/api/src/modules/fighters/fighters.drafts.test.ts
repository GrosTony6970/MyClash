/**
 * A fighter's pages span many Events (ruling 129 family 4, ruling 163): bout history, career
 * (and its "upcoming"), and the profile's recent bouts show public things only, for everyone —
 * only published, running and completed Tournaments of public Events. Before, a draft Tournament's
 * entry, and every entry of a draft Event, reached them. The career read also feeds the fighter's
 * own dashboard: an entrant sees nothing of a draft until it is published (ruling 164).
 */
import { describe, expect, it } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { FightersService } from './fighters.service';

const EVENTS = {
  open: { id: 'e-open', name: 'Open', slug: 'open', status: 'published', event_kind: 'standard' },
  draft: { id: 'e-draft', name: 'Draft', slug: 'draft', status: 'draft', event_kind: 'standard' },
  test: { id: 'e-test', name: 'Test', slug: 'test', status: 'published', event_kind: 'test' },
};

const entry = (
  id: string,
  tournamentStatus: string,
  event: (typeof EVENTS)[keyof typeof EVENTS],
) => ({
  id,
  tournament_id: `t-${id}`,
  status: 'registered',
  'persons.global_person_id': 'gp-lea',
  persons: { global_person_id: 'gp-lea' },
  tournaments: {
    id: `t-${id}`,
    name: `Tournament ${id}`,
    slug: `t-${id}`,
    status: tournamentStatus,
    weapon: 'Longsword',
    events: { ...event, start_date: '2026-06-01', end_date: '2026-06-02' },
  },
});

const REGISTRATIONS = [
  entry('r-open', 'completed', EVENTS.open),
  entry('r-draft-t', 'draft', EVENTS.open),
  entry('r-draft-e', 'published', EVENTS.draft),
  entry('r-test', 'published', EVENTS.test),
];
/** Only the public entry: its bouts are the only ones asked for. */
const ONLY_PUBLIC = 'red_registration_id.in.(r-open),blue_registration_id.in.(r-open)';

function build(tables: Partial<Record<string, TableSeed>> = {}) {
  const db = mockSupabase({
    global_persons: { rows: [{ id: 'gp-lea', slug: 'lea' }] },
    registrations: { rows: REGISTRATIONS },
    matches: { rows: [] },
    exchanges: { rows: [] },
    league_rankings: { rows: [] },
    // No roster row and no staff role: the profile itself is one the public may know of (rulings
    // 174, 177), so these tests hold the history's own filter.
    persons: { rows: [] },
    event_referees: { rows: [] },
    event_instructors: { rows: [] },
    ...tables,
  } as Record<string, TableSeed>);
  return { db, service: new FightersService(db as never, {} as never) };
}

describe("a fighter's pages show public Tournaments of public Events only (rulings 129, 163, 164)", () => {
  it('asks the bout history for the public entry only', async () => {
    const { db, service } = build({ matches: { data: [], error: null, count: 0 } });
    await service.listMatchesPaginated('lea', { limit: 20, offset: 0 });
    expect(filtersFor(db.from, 'matches', 'or')).toEqual([[ONLY_PUBLIC]]);
    // The double ignores projections: only this pin sees a status column go.
    expect(selectsFor(db.from, 'registrations')[0]).toBe(
      'id, tournament_id, persons!inner(global_person_id), tournaments(id, name, weapon, status, events(id, name, slug, start_date, end_date, status, event_kind))',
    );
  });

  it("counts an entry read without its Event's status as hidden: it fails closed", async () => {
    const [open] = REGISTRATIONS;
    const noStatus = {
      ...open,
      tournaments: {
        ...open!.tournaments,
        events: { ...open!.tournaments.events, status: undefined },
      },
    };
    const { db, service } = build({ registrations: { rows: [noStatus] } });
    await service.listMatchesPaginated('lea', { limit: 20, offset: 0 });
    expect(filtersFor(db.from, 'matches', 'or')).toEqual([]);
  });

  it('answers a history with nothing public as empty, asking for no bout', async () => {
    const { db, service } = build({ registrations: { rows: REGISTRATIONS.slice(1) } });
    expect(await service.listMatchesPaginated('lea', { limit: 20, offset: 0 })).toEqual({
      items: [],
      total: 0,
    });
    expect(filtersFor(db.from, 'matches', 'or')).toEqual([]);
  });

  it('builds the career, its upcoming entries included, from the public entry only', async () => {
    const { db, service } = build();
    const career = (await service.getCareerForFighter('gp-lea')) as unknown as {
      tournaments?: Array<{ tournamentId: string }>;
    };
    expect(filtersFor(db.from, 'matches', 'or')).toEqual([[ONLY_PUBLIC]]);
    expect(JSON.stringify(career)).not.toMatch(/r-draft|t-r-draft|e-draft|t-r-test/);
    // The double ignores projections: only this pin sees either status column go.
    expect(selectsFor(db.from, 'registrations')[0]?.replace(/\s+/g, ' ').trim()).toBe(
      'id, tournament_id, status, persons!inner ( global_person_id ), tournaments ( id, name, slug, status, weapon, events ( id, name, slug, status, start_date, end_date, event_kind ) )',
    );
  });

  it("asks the profile's recent bouts for the public entry only", async () => {
    const { db, service } = build();
    const recent = service as unknown as {
      getRecentMatchesForProfile(id: string): Promise<unknown[]>;
    };
    await recent.getRecentMatchesForProfile('gp-lea');
    expect(filtersFor(db.from, 'matches', 'or')).toEqual([[ONLY_PUBLIC], [ONLY_PUBLIC]]);
    expect(selectsFor(db.from, 'registrations')[0]).toBe(
      'id, persons!inner(global_person_id), tournaments(status, events(id, name, slug, status, event_kind))',
    );
    // The double ignores projections: only this pin sees the code's inputs go.
    for (const select of selectsFor(db.from, 'matches')) {
      expect(select).toContain(
        'phases(config_json,tournaments(weapon)),pools(sort_order),bracket_slots(round),swiss_rounds(round_number)',
      );
    }
  });

  it("names the profile's recent bouts by their code, never by their stored label", async () => {
    const bout = {
      id: 'm-1',
      status: 'running',
      scheduled_at: null,
      created_at: '2026-06-01T09:00:00Z',
      match_number_label: 'L1-PD-M01',
      red_registration_id: 'r-open',
      blue_registration_id: 'r-other',
      winner_registration_id: null,
      end_reason: null,
      red_score: 0,
      blue_score: 0,
      phases: { config_json: null, tournaments: { weapon: 'longsword' } },
      pools: { sort_order: 3 },
    };
    const { service } = build({ matches: { data: [bout], error: null } });
    const recent = service as unknown as {
      getRecentMatchesForProfile(id: string): Promise<Array<{ roundCode: string }>>;
    };
    const [first] = await recent.getRecentMatchesForProfile('gp-lea');
    expect(first?.roundCode).toBe('LSW-P4-M01');
  });
});
