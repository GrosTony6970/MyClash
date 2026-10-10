import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { createPenaltySchema } from '../penalties/dto/penalties.dto';
import { PenaltiesService } from '../penalties/penalties.service';
import { CreateExchangeDto } from './dto/matches.dto';
import { MatchesService } from './matches.service';

/**
 * A hit or a card says how old it is (the offline bout, slice 3).
 *
 * A tablet with no wifi keeps its hits and cards in a queue. One of them can
 * decide the bout: the hit at the cap, a black card. The server then stops the
 * clock by itself, and it must stop it at the time of that hit, not at the
 * time the queue arrives. So each of the two doors reads the age of what it
 * takes (`sentAt` minus `occurredAt`, off the server's own clock) and hands
 * that time to the recompute, and for a black card to the forfeit.
 *
 * A pad of before sends no `sentAt`: the server's press is of now, as it was.
 */
const NOW = '2026-10-10T11:00:00.000Z';
const SCORED_AT = '2026-10-10T10:20:00.000Z';
const HIT = { clientUuid: 'uuid-new', sequence: 4, type: 'no_exchange' };
const CARD = {
  clientUuid: 'uuid-new',
  sequence: 4,
  registrationId: 'reg-red',
  reason: 'struck after the halt',
};

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW) });
});
afterEach(() => {
  vi.useRealTimers();
});

/** The two times of a hit made at 10:20 and sent at 11:00, on a tablet `skewMinutes` wrong. */
function times(skewMinutes = 0) {
  const tablet = (iso: string) => new Date(Date.parse(iso) + skewMinutes * 60_000).toISOString();
  return { occurredAt: tablet(SCORED_AT), sentAt: tablet(NOW) };
}

function setup() {
  const db = mockSupabase({
    exchanges: { rows: [], returning: { id: 'ex-new' } },
    match_penalties: { rows: [], returning: { id: 'card-new' } },
    matches: {
      rows: [
        {
          id: 'm1',
          phase_id: 'phase-1',
          status: 'running',
          locked_at: null,
          red_registration_id: 'reg-red',
          blue_registration_id: 'reg-blue',
          current_round: 1,
          awaiting_round_advance: false,
        },
      ],
    },
    match_events: { rows: [] },
    phases: { rows: [{ id: 'phase-1', tournament_id: 'tournament-1' }] },
    tournaments: { rows: [{ id: 'tournament-1', event_id: 'event-1', penalty_ruleset_id: null }] },
    events: { rows: [{ id: 'event-1', organization_id: 'org-1', penalty_ruleset_id: null }] },
    penalty_rulesets: { rows: [] },
  });
  const scoring = { recomputeMatchScore: vi.fn() };
  const forfeits = { createForfeit: vi.fn() };
  const matches = new MatchesService(
    db as never,
    scoring as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const penalties = new PenaltiesService(
    db as never,
    scoring as never,
    undefined,
    undefined,
    forfeits as never,
  );
  const pad = { staffAccountId: 'pad-1' };
  return {
    scoring,
    forfeits,
    hit: (sent: object) => matches.createExchange('m1', { ...HIT, ...sent } as never),
    card: (kind: 'yellow' | 'black', sent: object) =>
      penalties.createPenalty('m1', { ...CARD, directCard: kind, ...sent } as never, pad),
  };
}

describe('a hit from a tablet’s queue', () => {
  it.each([
    ['whose clock is right', 0],
    ['whose clock is an hour ahead', 60],
    ['whose clock is an hour behind', -60],
  ])('hands the recompute the server’s time of the hit, on a tablet %s', async (_, skew) => {
    const { scoring, hit } = setup();

    await hit(times(skew));

    expect(scoring.recomputeMatchScore.mock.calls).toEqual([['m1', SCORED_AT]]);
  });

  it('of the pad of before hands it no time', async () => {
    const { scoring, hit } = setup();

    await hit({ occurredAt: SCORED_AT });

    expect(scoring.recomputeMatchScore.mock.calls).toEqual([['m1', undefined]]);
  });
});

describe('a card from a tablet’s queue', () => {
  it('hands the recompute the server’s time of the card', async () => {
    const { scoring, forfeits, card } = setup();

    await card('yellow', times(60));

    expect(scoring.recomputeMatchScore.mock.calls).toEqual([['m1', SCORED_AT]]);
    expect(forfeits.createForfeit).not.toHaveBeenCalled();
  });

  it('a black card hands that time to its forfeit too', async () => {
    const { forfeits, card } = setup();

    await card('black', times(-60));

    expect(forfeits.createForfeit.mock.calls).toEqual([
      [
        'm1',
        expect.objectContaining({ forfeitingRegistrationId: 'reg-red', reason: 'black_card_1' }),
        { staffAccountId: 'pad-1' },
        SCORED_AT,
      ],
    ]);
  });

  it('of the pad of before hands no time, to the recompute or to the forfeit', async () => {
    const { scoring, forfeits, card } = setup();

    await card('black', { occurredAt: SCORED_AT });

    expect(scoring.recomputeMatchScore.mock.calls).toEqual([['m1', undefined]]);
    expect(forfeits.createForfeit.mock.calls[0]?.[3]).toBeUndefined();
  });
});

describe('the two bodies', () => {
  const UUID = 'a0000000-0000-4000-8000-0000000000aa';
  const hit = (more: object) =>
    CreateExchangeDto.schema.safeParse({
      clientUuid: UUID,
      sequence: 1,
      type: 'double',
      occurredAt: SCORED_AT,
      ...more,
    }).success;
  const card = (more: object) =>
    createPenaltySchema.safeParse({
      clientUuid: UUID,
      sequence: 1,
      registrationId: UUID,
      directCard: 'yellow',
      reason: 'late',
      occurredAt: SCORED_AT,
      ...more,
    }).success;

  it.each([
    ['a hit', hit],
    ['a card', card],
  ])('%s takes a send time, and works with none', (_, parse) => {
    expect(parse({ sentAt: NOW })).toBe(true);
    expect(parse({})).toBe(true);
  });

  it.each([
    ['a hit', hit],
    ['a card', card],
  ])('%s with a send time that is no time is refused', (_, parse) => {
    expect(parse({ sentAt: 'eleven' })).toBe(false);
    expect(parse({ sentAt: null })).toBe(false);
  });
});
