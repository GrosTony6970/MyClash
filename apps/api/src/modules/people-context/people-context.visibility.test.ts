/**
 * The People hub's cards are public (`GET /me/people/context` answers anyone):
 * they must not show what the public pages hide (operator ruling 84). A draft
 * Event, a test Event and a Tournament that is not published/running/completed
 * leave no trace on a card; the card then reads exactly like one for a person
 * with no entries at all. The country follows the fighter's own
 * `public_visibility.nationality`. There is no photo setting to apply
 * (migration 0187 makes every photo public).
 */
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  selectsFor,
  type ChainResult,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { MePeopleController } from './me-people.controller';
import { PeopleContextService } from './people-context.service';

const GP_ID = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const VIEWER = '5d1c0f7e-2a8b-4c3d-9e6f-0a1b2c3d4e5f';
const FAILED: ChainResult = { data: null, error: { message: 'boom' } };

const PERSON = {
  id: GP_ID,
  slug: 'ana-rossi',
  display_name: 'Ana Rossi',
  photo_url: 'https://cdn.example/ana.jpg',
  country_code: 'FR',
  hema_ratings_id: null,
  public_visibility: {},
  clubs: { name: 'Salle Rossi' },
};

const PUBLIC_EVENT = { status: 'published', event_kind: 'standard' };
const HIDDEN_EVENTS: Array<[string, Record<string, unknown>]> = [
  ['a draft Event', { status: 'draft', event_kind: 'standard' }],
  ['a test Event', { status: 'published', event_kind: 'test' }],
];
const EVENT_NAMES = { id: 'e-1', name: 'Spring Open', slug: 'spring-open' };

const ENTRY = {
  id: 'r-1',
  person_id: 'p-1',
  tournament_id: 't-1',
  status: 'registered',
  tournaments: { status: 'published' },
};

const NEXT_BOUT = {
  id: 'm-1',
  match_number_label: 'L1-P1-M01',
  status: 'scheduled',
  scheduled_at: '2026-10-01T09:00:00Z',
  red_registration_id: 'r-1',
  blue_registration_id: 'r-2',
  pools: { name: 'Pool A' },
  lices: { name: 'Piste 1' },
  phases: { tournaments: { status: 'published' } },
};

const OPPONENT = {
  id: 'r-2',
  persons: { given_name: 'Bo', family_name: 'Lind', global_persons: null },
};

function refereeing(event: Record<string, unknown>) {
  return {
    person_id: GP_ID,
    role: 'skill-1',
    matches: {
      id: 'm-9',
      status: 'running',
      scheduled_at: null,
      match_number_label: 'L2-P3-M04',
      lices: { name: 'Piste 2' },
      pools: { name: 'Pool C' },
      phases: {
        tournaments: {
          slug: 'sabre',
          status: 'running',
          events: { slug: 'spring-open', name: 'Spring Open', ...event },
        },
      },
    },
  };
}

function lastEntry(event: Record<string, unknown>) {
  return {
    id: 'r-7',
    status: 'registered',
    persons: { global_person_id: GP_ID },
    tournaments: {
      id: 't-7',
      name: 'Rapier',
      slug: 'rapier',
      weapon: null,
      status: 'completed',
      events: { name: 'Winter Cup', slug: 'winter-cup', start_date: '2026-01-10', ...event },
    },
  };
}

/** Nothing but the person: the card of someone with no entries anywhere. */
const NOTHING: Record<string, TableSeed> = {
  global_persons: { data: [PERSON], error: null },
  referee_assignments: { data: [], error: null },
  persons: { data: [], error: null },
  registrations: { data: [], error: null },
  referee_skills: { data: [], error: null },
};

/** A public Event: a next bout, a pool, and a live bout the person referees. */
const EVERYTHING: Record<string, TableSeed> = {
  ...NOTHING,
  referee_assignments: { data: [refereeing(PUBLIC_EVENT)], error: null },
  persons: { data: [{ id: 'p-1', global_person_id: GP_ID, events: PUBLIC_EVENT }], error: null },
  registrations: [
    { data: [ENTRY], error: null },
    { data: [OPPONENT], error: null },
  ],
  matches: { data: [NEXT_BOUT], error: null },
  tournaments: {
    data: [{ id: 't-1', name: 'Longsword', slug: 'longsword', weapon: null, events: EVENT_NAMES }],
    error: null,
  },
  pool_members: { data: [{ registration_id: 'r-1', pools: { name: 'Pool A' } }], error: null },
  referee_skills: { data: [{ id: 'skill-1', name: 'Centre', color: '#123456' }], error: null },
};

async function enrichWith(tables: Record<string, TableSeed>, viewer: string | null = null) {
  const supabase = mockSupabase(tables);
  const svc = new PeopleContextService(
    supabase as never,
    { getPoolStandings: vi.fn().mockResolvedValue({ rows: [] }) } as never,
    { getTournamentBracket: vi.fn().mockResolvedValue({ slots: [] }) } as never,
    { filterFollowedGlobalPersons: vi.fn().mockResolvedValue(new Set()) } as never,
  );
  const [card] = await svc.enrich([GP_ID], viewer);
  return { card, from: supabase.from };
}

const collapse = (select: string | undefined) => (select ?? '').replace(/\s+/g, ' ').trim();

describe('people context shows only what the public may see (ruling 84)', () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows a public Event's Tournament, pool, next bout and refereeing", async () => {
    const { card } = await enrichWith(EVERYTHING);
    expect(card).toMatchObject({
      countryCode: 'FR',
      photoUrl: 'https://cdn.example/ana.jpg',
      event: { slug: 'spring-open' },
      tournament: { name: 'Longsword' },
      poolName: 'Pool A',
      nextMatch: { matchId: 'm-1', opponentName: 'Bo Lind', eventSlug: 'spring-open' },
      currentMatch: { kind: 'referee', matchId: 'm-9', skillName: 'Centre' },
    });
  });

  it.each(HIDDEN_EVENTS)(
    "answers %s's entry exactly like a person with none, whoever asks",
    async (_label, event) => {
      const { card: none } = await enrichWith(NOTHING);
      const hidden = {
        ...EVERYTHING,
        referee_assignments: { data: [], error: null },
        persons: { data: [{ id: 'p-1', global_person_id: GP_ID, events: event }], error: null },
      };
      expect((await enrichWith(hidden)).card).toEqual(none);
      expect((await enrichWith(hidden, VIEWER)).card).toEqual(none);
    },
  );

  it('answers an entry in a hidden Tournament exactly like none', async () => {
    const { card: none } = await enrichWith(NOTHING);
    const hidden = {
      ...EVERYTHING,
      referee_assignments: { data: [], error: null },
      registrations: { data: [{ ...ENTRY, tournaments: { status: 'draft' } }], error: null },
      matches: { data: [], error: null },
    };
    expect((await enrichWith(hidden)).card).toEqual(none);
  });

  it.each(HIDDEN_EVENTS)('hides a live bout refereed in %s', async (_label, event) => {
    const { card: none } = await enrichWith(NOTHING);
    const hidden = { ...NOTHING, referee_assignments: { data: [refereeing(event)], error: null } };
    expect((await enrichWith(hidden)).card).toEqual(none);
  });

  it('shows the last result of a public Event', async () => {
    const shown = { ...NOTHING, registrations: { data: [lastEntry(PUBLIC_EVENT)], error: null } };
    expect((await enrichWith(shown)).card?.lastResult).toMatchObject({ eventSlug: 'winter-cup' });
  });

  it.each(HIDDEN_EVENTS)('hides the last result of %s', async (_label, event) => {
    const { card: none } = await enrichWith(NOTHING);
    const hidden = { ...NOTHING, registrations: { data: [lastEntry(event)], error: null } };
    expect((await enrichWith(hidden)).card).toEqual(none);
  });

  it.each([
    [{}, 'FR'],
    [null, 'FR'],
    [{ nationality: true }, 'FR'],
    [{ nationality: false }, null],
  ])('shows the country only as public_visibility %j allows', async (visibility, country) => {
    const tables = {
      ...NOTHING,
      global_persons: { data: [{ ...PERSON, public_visibility: visibility }], error: null },
    };
    const { card } = await enrichWith(tables);
    expect(card?.countryCode).toBe(country);
    // No photo setting exists (migration 0187): hiding the country keeps the photo.
    expect(card?.photoUrl).toBe(PERSON.photo_url);
  });

  it('reads the columns each decision needs', async () => {
    const { from } = await enrichWith(EVERYTHING);
    expect(collapse(selectsFor(from, 'global_persons')[0])).toBe(
      'id, slug, display_name, photo_url, country_code, public_visibility, hema_ratings_id, clubs ( name )',
    );
    expect(collapse(selectsFor(from, 'persons')[0])).toBe(
      'id, global_person_id, events!inner ( status, event_kind )',
    );
    expect(collapse(selectsFor(from, 'registrations')[0])).toBe(
      'id, person_id, tournament_id, status, tournaments ( status )',
    );
    expect(collapse(selectsFor(from, 'referee_assignments')[0])).toContain(
      'phases ( tournaments ( slug, status, events ( slug, name, status, event_kind ) ) )',
    );

    const idle = await enrichWith(NOTHING);
    expect(collapse(selectsFor(idle.from, 'registrations')[0])).toContain(
      'events!inner ( name, slug, start_date, status, event_kind )',
    );
  });

  it.each([
    ['global_persons', { global_persons: FAILED }],
    ['referee_assignments', { referee_assignments: FAILED }],
    ['referee_skills', { referee_skills: FAILED }],
    ['persons', { persons: FAILED }],
    ['registrations (entries)', { registrations: FAILED }],
    ['registrations (opponents)', { registrations: [{ data: [ENTRY], error: null }, FAILED] }],
    ['matches', { matches: FAILED }],
    ['tournaments', { tournaments: FAILED }],
    ['pool_members', { pool_members: FAILED }],
  ])('fails a failed %s read loudly, never as a person with no entries', async (_t, broken) => {
    const read = enrichWith({ ...EVERYTHING, ...broken });
    await expect(read).rejects.toThrow('read failed: boom');
    await expect(read).rejects.not.toBeInstanceOf(HttpException);
  });

  it('fails a failed last-result read loudly', async () => {
    const read = enrichWith({ ...NOTHING, registrations: FAILED });
    await expect(read).rejects.toThrow('read failed: boom');
    await expect(read).rejects.not.toBeInstanceOf(HttpException);
  });
});

describe('GET /me/people/context takes only well-formed ids', () => {
  function controller() {
    const enrich = vi.fn().mockResolvedValue([]);
    const ctl = new MePeopleController({ enrich } as never, {} as never, {} as never);
    const call = (raw: string) => ctl.context(raw, { headers: {}, cookies: {} } as never);
    return { enrich, call };
  }

  it('drops a malformed id like an unknown one, and keeps the rest of the batch', async () => {
    const { enrich, call } = controller();
    await call(`abc, ${GP_ID},,'; drop`);
    expect(enrich).toHaveBeenCalledWith([GP_ID], null);
  });

  it('answers a batch with no well-formed id with [] and reads nothing', async () => {
    const { enrich, call } = controller();
    expect(await call('abc,anonymous')).toEqual([]);
    expect(enrich).not.toHaveBeenCalled();
  });
});
