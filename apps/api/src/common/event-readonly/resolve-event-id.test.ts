import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { buildMigrationSchema } from '../testing/migration-schema';
import { filtersFor, mockSupabase, selectsFor } from '../testing/supabase-chain';
import { placementsOf, resolveEventId } from './resolve-event-id';

/**
 * Which Event a write touches, read off the route the router matched (ruling
 * 222). The API-wide sweep is `archived-lock.routes.test.ts`; real requests
 * through the router are `archived-lock.http.test.ts`.
 */
const EVENT = 'e1000000-0000-4000-8000-000000000001';
const OTHER = 'e2000000-0000-4000-8000-000000000002';
const ROW = 'a1000000-0000-4000-8000-000000000001';
const DECOY = 'a2000000-0000-4000-8000-000000000002';

const request = (
  pattern: string | undefined,
  params: Record<string, string> = {},
  body: Record<string, unknown> = {},
  url = '/api/v1/somewhere',
) =>
  ({
    method: 'PATCH',
    url,
    routeOptions: { url: pattern },
    params,
    body,
  }) as unknown as FastifyRequest;

const atEvent = (eventId: string) => ({ event_id: eventId });
const viaTournament = (eventId: string) => ({ tournaments: { event_id: eventId } });
const viaPhase = (eventId: string) => ({ phases: viaTournament(eventId) });

/** segment, table, the select the lock must send, the row's way to its Event. */
const TABLE: Array<[string, string, string, (eventId: string) => object]> = [
  ['tournaments', 'tournaments', 'event_id', atEvent],
  ['phases', 'phases', 'tournaments!inner(event_id)', viaTournament],
  ['swiss-phases', 'phases', 'tournaments!inner(event_id)', viaTournament],
  ['pools', 'pools', 'phases!inner(tournaments!inner(event_id))', viaPhase],
  ['matches', 'matches', 'phases!inner(tournaments!inner(event_id))', viaPhase],
  ['swiss-rounds', 'swiss_rounds', 'phases!inner(tournaments!inner(event_id))', viaPhase],
  ['bracket-slots', 'bracket_slots', 'phases!inner(tournaments!inner(event_id))', viaPhase],
  [
    'exchanges',
    'exchanges',
    'matches!inner(phases!inner(tournaments!inner(event_id)))',
    (eventId) => ({ matches: [viaPhase(eventId)] }),
  ],
  ['registrations', 'registrations', 'tournaments!inner(event_id)', viaTournament],
  ['match-forfeits', 'match_forfeits', 'tournaments!inner(event_id)', viaTournament],
  ['match-penalties', 'match_penalties', 'tournaments!inner(event_id)', viaTournament],
  [
    'tournament-penalty-reviews',
    'tournament_penalty_reviews',
    'tournaments!inner(event_id)',
    viaTournament,
  ],
  ['persons', 'persons', 'event_id', atEvent],
  ['lices', 'lices', 'event_id', atEvent],
  ['referee-assignments', 'referee_assignments', 'event_id', atEvent],
  ['referee-qualifications', 'referee_qualifications', 'event_id', atEvent],
  ['referee-skills', 'referee_skills', 'event_id', atEvent],
  ['workshops', 'workshops', 'event_id', atEvent],
  [
    'workshop-sessions',
    'workshop_sessions',
    'workshops!inner(event_id)',
    (eventId) => ({ workshops: atEvent(eventId) }),
  ],
  ['workshop-breaks', 'workshop_breaks', 'event_id', atEvent],
];

describe('resolveEventId', () => {
  it.each(TABLE)('places %s/:id through %s', async (segment, table, select, toEvent) => {
    const db = mockSupabase({
      [table]: {
        rows: [
          { id: DECOY, ...toEvent(OTHER) },
          { id: ROW, ...toEvent(EVENT) },
        ],
      },
    });

    expect(await resolveEventId(db as never, request(`/api/v1/${segment}/:id`, { id: ROW }))).toBe(
      EVENT,
    );
    expect(selectsFor(db.from, table)).toEqual([select]);
    expect(filtersFor(db.from, table, 'eq')).toEqual([['id', ROW]]);
  });

  it('leaves a row it cannot find to the handler', async () => {
    const db = mockSupabase({ tournaments: { rows: [{ id: DECOY, event_id: OTHER }] } });
    expect(await resolveEventId(db as never, request('/api/v1/tournaments/:id', { id: ROW }))).toBe(
      null,
    );
  });

  it('answers a failed read with a plain Error, so the write gets a 500 and not a pass', async () => {
    const db = mockSupabase({
      tournaments: { data: null, error: { code: '08006', message: 'connection refused' } },
    });
    const write = resolveEventId(db as never, request('/api/v1/tournaments/:id', { id: ROW }));
    await expect(write).rejects.toEqual(
      new Error('The archived-Event lock could not read tournaments: connection refused'),
    );
  });

  it('reads an id Postgres cannot read as a uuid as no row (the pipe refuses it after)', async () => {
    const db = mockSupabase({
      tournaments: { data: null, error: { code: '22P02', message: 'invalid input syntax' } },
    });
    const typo = request('/api/v1/tournaments/:id', { id: 'abc' });
    expect(await resolveEventId(db as never, typo)).toBe(null);
  });

  it('places no system skill: it belongs to no Event', async () => {
    const db = mockSupabase({ referee_skills: { rows: [{ id: 'arbitre', event_id: null }] } });
    const skill = request('/api/v1/referee-skills/:skillId', { skillId: 'arbitre' });
    expect(await resolveEventId(db as never, skill)).toBe(null);
  });

  it('takes an Event id as it is, with no read', async () => {
    const db = mockSupabase({});
    for (const pattern of ['/api/v1/events/:id', '/api/v1/events/:eventId/things']) {
      const params = { id: EVENT, eventId: EVENT };
      expect(await resolveEventId(db as never, request(pattern, params))).toBe(EVENT);
    }
    expect(db.from).not.toHaveBeenCalled();
  });

  it('looks for a uuid of no RFC version as an id, then as a slug', async () => {
    // `event-ref.ts` reads it as a slug, `ParseUUIDPipe` as an id: the lock asks both.
    const HAND_MADE = '00000000-0000-0000-0000-000000000001';
    const SLUG_LIKE = '00000000-0000-0000-0000-000000000002';
    const db = mockSupabase({
      events: {
        rows: [
          { id: HAND_MADE, slug: 'seeded' },
          { id: EVENT, slug: SLUG_LIKE },
        ],
      },
    });
    const pass = (ref: string) => request('/api/v1/events/:eventId/pass', { eventId: ref });

    expect(await resolveEventId(db as never, pass(HAND_MADE))).toBe(HAND_MADE);
    expect(await resolveEventId(db as never, pass(SLUG_LIKE))).toBe(EVENT);
  });

  it('reads an Event named by its slug, and places it only when one Event has it', async () => {
    const db = mockSupabase({
      events: {
        rows: [
          { id: EVENT, slug: 'open-2025' },
          { id: OTHER, slug: 'shared' },
          { id: DECOY, slug: 'shared' },
        ],
      },
    });
    const pass = (slug: string) => request('/api/v1/events/:eventId/pass', { eventId: slug });

    expect(await resolveEventId(db as never, pass('open-2025'))).toBe(EVENT);
    expect(await resolveEventId(db as never, pass('shared'))).toBe(null);
    expect(await resolveEventId(db as never, pass('nobody'))).toBe(null);
    expect(selectsFor(db.from, 'events')).toEqual(['id', 'id', 'id']);
    expect(filtersFor(db.from, 'events', 'eq')[0]).toEqual(['slug', 'open-2025']);
    expect(filtersFor(db.from, 'events', 'limit')[0]).toEqual([2]);
  });

  it('asks the pairs left to right and stops at the first that names an Event', async () => {
    const db = mockSupabase({
      tournaments: { rows: [{ id: ROW, event_id: EVENT }] },
      registrations: { rows: [{ id: DECOY, ...viaTournament(OTHER) }] },
    });
    const nested = request('/api/v1/tournaments/:tournamentId/registrations/:id', {
      tournamentId: ROW,
      id: DECOY,
    });

    expect(await resolveEventId(db as never, nested)).toBe(EVENT);
    expect(selectsFor(db.from, 'registrations')).toEqual([]);
  });

  it('goes on to the next pair when a row is not found', async () => {
    const db = mockSupabase({
      tournaments: { rows: [] },
      registrations: { rows: [{ id: DECOY, ...viaTournament(OTHER) }] },
    });
    const nested = request('/api/v1/tournaments/:tournamentId/registrations/:id', {
      tournamentId: ROW,
      id: DECOY,
    });
    expect(await resolveEventId(db as never, nested)).toBe(OTHER);
  });

  it('reads the Event the body names only when the route places nothing', async () => {
    const db = mockSupabase({ tournaments: { rows: [{ id: ROW, event_id: EVENT }] } });
    const body = { eventId: OTHER };

    expect(
      await resolveEventId(db as never, request('/api/v1/referee-assignments', {}, body)),
    ).toBe(OTHER);
    const placed = request('/api/v1/tournaments/:id', { id: ROW }, body);
    expect(await resolveEventId(db as never, placed)).toBe(EVENT);
    expect(await resolveEventId(db as never, request('/api/v1/auth/logout'))).toBe(null);
    // Not a uuid: no Event can be read with it, and the pipe refuses it after the lock.
    const typo = request('/api/v1/referee-assignments', {}, { eventId: 'abc' });
    expect(await resolveEventId(db as never, typo)).toBe(null);
  });

  it('reads the matched route, never the address as written', async () => {
    const db = mockSupabase({ tournaments: { rows: [{ id: ROW, event_id: EVENT }] } });
    const encoded = request(
      '/api/v1/tournaments/:id',
      { id: ROW },
      {},
      `/api/v1/tourn%61ments/${ROW}?next=/events/${OTHER}`,
    );
    expect(await resolveEventId(db as never, encoded)).toBe(EVENT);
  });

  it('refuses to answer for a request the router did not match', async () => {
    await expect(resolveEventId(mockSupabase({}) as never, request(undefined))).rejects.toThrow(
      'no matched route to read',
    );
  });
});

describe('placementsOf', () => {
  it('keys a pair on its segment, and an Event on a param named eventId anywhere', () => {
    expect(placementsOf('/api/v1/display/wall/:eventId', { eventId: EVENT })).toEqual([
      { segment: 'events', value: EVENT },
    ]);
    expect(placementsOf('/api/v1/tournaments/:id/publish', { id: ROW })).toEqual([
      { segment: 'tournaments', value: ROW },
    ]);
  });

  it('places nothing for a segment of no table, a missing value, or an inherited key', () => {
    expect(placementsOf('/api/v1/clubs/:id', { id: ROW })).toEqual([]);
    expect(placementsOf('/api/v1/tournaments/:id', {})).toEqual([]);
    expect(placementsOf('/api/v1/constructor/:id', { id: ROW })).toEqual([]);
    expect(placementsOf('/api/v1/match-forfeits/:id/void', { id: ROW })).toEqual([
      { segment: 'match-forfeits', value: ROW },
    ]);
  });
});

describe('the embeds the lock reads', () => {
  const schema = buildMigrationSchema();
  const keysBetween = (a: string, b: string) =>
    [...(schema.references.get(a)?.values() ?? [])].filter((target) => target.table === b).length +
    [...(schema.references.get(b)?.values() ?? [])].filter((target) => target.table === a).length;

  // A second foreign key between two of these tables makes PostgREST refuse the
  // embed as ambiguous, and every write of that kind would lose its lock.
  it.each([
    ['phases', 'tournaments'],
    ['pools', 'phases'],
    ['matches', 'phases'],
    ['swiss_rounds', 'phases'],
    ['bracket_slots', 'phases'],
    ['exchanges', 'matches'],
    ['registrations', 'tournaments'],
    ['match_forfeits', 'tournaments'],
    ['match_penalties', 'tournaments'],
    ['tournament_penalty_reviews', 'tournaments'],
    ['workshop_sessions', 'workshops'],
  ])('joins %s to %s by exactly one foreign key', (from, to) => {
    expect(keysBetween(from, to)).toBe(1);
  });
});
