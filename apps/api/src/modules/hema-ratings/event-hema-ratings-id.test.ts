/**
 * Which HEMA Ratings id an Event's readers rate or submit a fighter by.
 *
 * The roster row's, else the linked global profile's (operator rulings 39 and
 * 42, 2026-09-22). Since ruling 35 an entry no longer copies the id the
 * organiser typed onto the shared profile, so the seeding readers, which read
 * the profile alone, would seed that fighter as unrated; the public list and
 * the export read the roster row alone and missed an id set on the profile.
 * Driven through each reader, since each must select both columns and hand
 * its row to `eventHemaRatingsId`.
 *
 * Three fighters tell the rule from its neighbours: A has an id on the roster
 * row only, B a blank one there and an id on the profile, C an id on both that
 * differ — the roster row's wins. Pool generation and bracket seeding use A
 * alone; the rest use all three.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  mockSupabase,
  selectsFor,
  writesTo,
  type SupabaseRow,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { EventsService } from '../events/events.service';
import { ExportsService } from '../exports/exports.service';
import { toSubmissionFighter } from '../exports/hema-ratings-rows';
import { PhasesService } from '../phases/phases.service';
import { SwissSeedingService } from '../swiss/swiss-seeding.service';
import { eventHemaRatingsId } from './event-hema-ratings-id';

const RATINGS = new Map([
  ['hA', 1500],
  ['hB', 1400],
  ['hC', 1300],
  // C's profile id: rating by it would be the wrong fighter's rank.
  ['hX', 1999],
]);

const PERSON_A = { hema_ratings_id: 'hA', global_persons: null };
const PERSON_B = { hema_ratings_id: '  ', global_persons: { hema_ratings_id: 'hB' } };
const PERSON_C = { hema_ratings_id: 'hC', global_persons: { hema_ratings_id: 'hX' } };
const UNRATED = { hema_ratings_id: null, global_persons: null };
const NAMED = { given_name: 'F', family_name: 'Fighter', clubs: null };

/** What the ratings lookup is asked, and the embed every rating reader selects. */
const RATED_EMBED = 'hema_ratings_id, global_persons(hema_ratings_id)';

let resolveWeightedRatings: Mock;

beforeEach(() => {
  resolveWeightedRatings = vi.fn(
    async (ids: string[]) =>
      new Map(ids.flatMap((id) => (RATINGS.has(id) ? [[id, RATINGS.get(id)!]] : []))),
  );
});

function makeService(seed: Record<string, TableSeed>) {
  const supabase = mockSupabase(seed);
  const service = new PhasesService(
    supabase as never,
    { placeMatches: vi.fn(() => Promise.resolve()) } as never,
    { resolveWeightedRatings } as never,
    { assertOrgRole: vi.fn().mockResolvedValue(undefined) } as never,
  );
  return { service, supabase };
}

const LONGSWORD: SupabaseRow = {
  id: 'tournament-1',
  weapon: 'longsword',
  event_id: 'event-1',
  events: { organization_id: 'org-1' },
};

describe("the Pool readers rate a fighter by the roster row's id first", () => {
  it('the Pools list', async () => {
    const member = (registrationId: string, person: SupabaseRow) => ({
      registration_id: registrationId,
      seed: 1,
      registrations: { persons: { ...NAMED, ...person } },
    });
    const { service, supabase } = makeService({
      phases: {
        rows: [
          {
            id: 'phase-1',
            tournament_id: 'tournament-1',
            type: 'pool',
          },
        ],
      },
      pools: {
        data: [
          {
            id: 'pool-1',
            name: 'Pool 1',
            sort_order: 0,
            pool_members: [member('rA', PERSON_A), member('rB', PERSON_B), member('rC', PERSON_C)],
          },
        ],
        error: null,
      },
      tournaments: { rows: [LONGSWORD] },
      registrations: {
        data: [{ persons: PERSON_A }, { persons: PERSON_B }, { persons: PERSON_C }],
        error: null,
      },
    });

    const result = await service.listTournamentPools('tournament-1');

    expect(result.pools[0]?.members.map((m) => m.hemaWeightedRating)).toEqual([1500, 1400, 1300]);
    expect(resolveWeightedRatings).toHaveBeenCalledWith(['hA', 'hB', 'hC'], 'longsword');
    expect(selectsFor(supabase.from, 'pools')[0]).toContain(`clubs(name), ${RATED_EMBED}`);
    expect(selectsFor(supabase.from, 'registrations')).toEqual([`persons(${RATED_EMBED})`]);
  });

  it('the fighters not yet in a Pool', async () => {
    const { service, supabase } = makeService({
      // Canned: the panel's own read and the ratings read both get these rows.
      registrations: {
        data: [
          { id: 'rA', persons: { ...NAMED, ...PERSON_A } },
          { id: 'rB', persons: { ...NAMED, ...PERSON_B } },
          { id: 'rC', persons: { ...NAMED, ...PERSON_C } },
        ],
        error: null,
      },
      pool_members: { data: [], error: null },
      tournaments: { rows: [LONGSWORD] },
    });

    const fighters = await service.listUnassignedFighters('tournament-1');

    expect(fighters.map((f) => f.hemaWeightedRating)).toEqual([1500, 1400, 1300]);
    expect(selectsFor(supabase.from, 'registrations')).toEqual([
      `id, persons(given_name, family_name, clubs(name), ${RATED_EMBED})`,
      `persons(${RATED_EMBED})`,
    ]);
  });

  it('Pool generation', async () => {
    const reg = (id: string, seed: number, person: SupabaseRow): SupabaseRow => ({
      id,
      seed,
      bib_number: null,
      tournament_id: 'tournament-1',
      status: 'registered',
      persons: { club_id: null, ...person },
    });
    const { service, supabase } = makeService({
      phases: { rows: [], returning: { id: 'phase-new' } },
      tournaments: { rows: [LONGSWORD] },
      registrations: { rows: [reg('rA', 1, PERSON_A), reg('rN', 2, UNRATED)] },
      pools: { rows: [], returning: { id: 'pool-new' } },
      pool_members: { rows: [] },
      matches: { rows: [] },
    });

    await service.generatePools('tournament-1', { poolCount: 2 }, false);

    expect(resolveWeightedRatings).toHaveBeenCalledWith(['hA'], 'longsword');
    // One fighter per Pool: A's 1500 against nobody rated. Rated by the profile
    // alone, both are unrated and the Pools cannot differ in skill at all.
    const inserted = writesTo(supabase, 'phases').find((write) => write.op === 'insert');
    const config = (inserted?.row as { config_json: { costReport: { skillVariance: number } } })
      .config_json;
    expect(config.costReport.skillVariance).toBeGreaterThan(0);
    expect(selectsFor(supabase.from, 'registrations')[0]).toBe(
      `id, seed, bib_number, persons(club_id, ${RATED_EMBED})`,
    );
  });
});

describe("bracket seeding by rating rates a fighter by the roster row's id first", () => {
  it('puts the fighter rated only on the roster row in seed 1', async () => {
    const { service, supabase } = makeService({
      phases: {
        rows: [
          {
            id: 'phase-1',
            type: 'single_elim',
            tournament_id: 'tournament-1',
            tournaments: { event_id: 'event-1', events: { organization_id: 'org-1' } },
            config_json: {},
          },
        ],
      },
      bracket_slots: {
        rows: [
          {
            id: 'slot-1',
            phase_id: 'phase-1',
            round: 1,
            position: 1,
            source_a_ref: 'seed 1',
            source_b_ref: 'seed 2',
            registration_a_id: null,
            registration_b_id: null,
          },
        ],
      },
      // Canned: the seedable read and the ratings read both get these rows.
      // Seed order alone would put r1 first.
      registrations: {
        data: [
          { id: 'r1', seed: 1, bib_number: null, persons: UNRATED },
          { id: 'r2', seed: 2, bib_number: null, persons: PERSON_A },
        ],
        error: null,
      },
      tournaments: { rows: [LONGSWORD] },
      matches: { data: [], error: null },
      audit_log: { rows: [] },
    });

    await service.reseedBracketRoundOne('phase-1', 'actor-1', { strategy: 'by-rating' });

    const [filled] = writesTo(supabase, 'bracket_slots');
    expect(filled?.row).toEqual({ registration_a_id: 'r2', registration_b_id: 'r1' });
  });
});

describe("Swiss seeding rates a fighter by the roster row's id first", () => {
  it('the registrations it seeds', async () => {
    const supabase = mockSupabase({
      registrations: {
        data: [
          { id: 'rA', persons: PERSON_A },
          { id: 'rB', persons: PERSON_B },
          { id: 'rC', persons: PERSON_C },
        ],
        error: null,
      },
    });

    const regs = await new SwissSeedingService(supabase as never).loadRegistrations('tournament-1');

    expect(regs.map((r) => r.hemaRatingsId)).toEqual(['hA', 'hB', 'hC']);
    expect(selectsFor(supabase.from, 'registrations')).toEqual([
      `id, seed, bib_number, persons(club_id, ${RATED_EMBED})`,
    ]);
  });
});

describe('eventHemaRatingsId', () => {
  it('takes the roster row, else the profile; blank or missing counts as none', () => {
    expect([PERSON_A, PERSON_B, PERSON_C, UNRATED, null].map(eventHemaRatingsId)).toEqual([
      'hA',
      'hB',
      'hC',
      null,
      null,
    ]);
  });
});

describe("the public participants list and the HEMA Ratings export read the roster row's id first", () => {
  it('the public participants list', async () => {
    const resolveWeaponRatings = vi.fn(async (ids: string[]) => ({
      byId: new Map(
        ids.flatMap((id) =>
          RATINGS.has(id) ? [[id, { weightedRating: RATINGS.get(id)!, rank: null }]] : [],
        ),
      ),
      byName: new Map(),
    }));
    const person = (id: string, rated: SupabaseRow) => ({
      id,
      ...NAMED,
      club_id: null,
      global_person_id: `g-${id}`,
      ...rated,
    });
    const supabase = mockSupabase({
      events: {
        data: { id: 'event-1', slug: 'fal', status: 'published', organization_id: 'org-1' },
        error: null,
      },
      tournaments: {
        data: [{ id: 't1', slug: 'ls', name: 'Longsword', color: null, weapon: 'longsword' }],
        error: null,
      },
      registrations: {
        data: ['pA', 'pB', 'pC'].map((id) => ({
          tournament_id: 't1',
          person_id: id,
          status: 'registered',
          waitlist_position: null,
        })),
        error: null,
      },
      persons: {
        data: [person('pA', PERSON_A), person('pB', PERSON_B), person('pC', PERSON_C)],
        error: null,
      },
      clubs: { data: [], error: null },
      event_referees: { data: [], error: null },
      event_instructors: { data: [], error: null },
    });
    const events = new EventsService(
      supabase as never,
      { assertOrgRole: vi.fn() } as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      { resolveWeaponRatings } as never,
    );

    const rows = await events.listPublicParticipants('fal', async () => 'anonymous');

    expect(rows.map((row) => row.tournaments[0]?.hemaRating?.weightedRating)).toEqual([
      1500, 1400, 1300,
    ]);
    expect(resolveWeaponRatings).toHaveBeenCalledWith(
      ['hA', 'hB', 'hC'],
      expect.any(Array),
      'longsword',
    );
    expect(selectsFor(supabase.from, 'persons')[0]).toContain(
      'hema_ratings_id, global_person_id, global_persons(hema_ratings_id)',
    );
  });

  it('the HEMA Ratings export', async () => {
    const row = (rated: SupabaseRow) => ({
      id: 'p',
      ...NAMED,
      club_id: null,
      gender_category: null,
      ...rated,
    });
    expect(
      [PERSON_A, PERSON_B, PERSON_C, UNRATED].map(
        (rated) => toSubmissionFighter(row(rated), new Map()).hemaRatingsId,
      ),
    ).toEqual(['hA', 'hB', 'hC', null]);

    const supabase = mockSupabase({
      persons: { data: [row(PERSON_A)], error: null },
      clubs: { data: [], error: null },
    });
    await (
      new ExportsService(supabase as never) as unknown as {
        fetchFightersAndClubs(ids: string[]): Promise<unknown>;
      }
    ).fetchFightersAndClubs(['p']);
    expect(selectsFor(supabase.from, 'persons')[0]).toMatch(
      /hema_ratings_id[\s\S]*global_persons \( country_code, hema_ratings_id \)/,
    );
  });
});
