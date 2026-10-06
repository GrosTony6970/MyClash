import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  scopedTo,
  selectsFor,
  writesTo,
} from '../../common/testing/supabase-chain';
import { FrozenResultsGuard } from '../matches/frozen-results.guard';
import { MatchForfeitsService } from '../matches/match-forfeits.service';
import { PenaltiesController } from './penalties.controller';
import { PenaltiesService } from './penalties.service';

/**
 * Ruling 319: taking a black card back takes back what the card did. The bout
 * returns to what it was, and a Fighter the card put out of the Tournament is
 * back in. It lands whole or not at all: where the forfeit cannot be taken
 * back, the card stays.
 *
 * The REAL `MatchForfeitsService` is under test with the service. The double
 * applies no write, so every claim here is a write and its filter.
 */
const SCORER = 'a0000000-0000-4000-8000-000000000001';
const REFUSED = { code: 'black_card_undo_refused' };

const BEFORE_THE_CARD = {
  status: 'running',
  red_score: 2,
  blue_score: 1,
  winner_registration_id: null,
  ended_at: null,
  end_reason: null,
};
const AFTER_THE_CARD = {
  status: 'completed',
  red_score: 5,
  blue_score: 0,
  winner_registration_id: 'reg-red',
  ended_at: '2026-10-06T10:00:00.000Z',
  end_reason: 'black_card',
};

type Rows = Record<string, unknown>[];

interface Seed {
  cards?: Rows;
  forfeit?: Record<string, unknown> | null;
  bout?: Record<string, unknown>;
  laterBout?: Record<string, unknown>;
  reviews?: Rows;
  /** Every call on the reviews table answers an error. */
  reviewsFault?: boolean;
  eventStatus?: string;
}

const blackCard = (over: Record<string, unknown> = {}) => ({
  id: 'card-black',
  match_id: 'm1',
  tournament_id: 'tournament-1',
  registration_id: 'reg-blue',
  card: 'black',
  voided: false,
  ...over,
});

const FORFEIT = {
  id: 'forfeit-1',
  match_id: 'm1',
  parent_forfeit_id: null,
  forfeiting_registration_id: 'reg-blue',
  replacement_registration_id: null,
  reason: 'black_card_2',
  voided_at: null,
  downstream_match_ids: [],
  previous_match_state: BEFORE_THE_CARD,
  previous_registration_state: { id: 'reg-blue', status: 'confirmed' },
  resulting_match_state: AFTER_THE_CARD,
};
const BOUT = {
  id: 'm1',
  phase_id: 'phase-1',
  locked_at: null,
  current_round: 1,
  red_registration_id: 'reg-red',
  blue_registration_id: 'reg-blue',
  ...AFTER_THE_CARD,
};
const LATER_BOUT = { id: 'm2', status: 'scheduled', started_at: null };

function setup(seed: Seed = {}) {
  const db = mockSupabase({
    match_penalties: { rows: seed.cards ?? [blackCard()] },
    match_forfeits: { rows: seed.forfeit === null ? [] : [{ ...FORFEIT, ...seed.forfeit }] },
    matches: {
      rows: [
        { ...BOUT, ...seed.bout },
        { ...LATER_BOUT, ...seed.laterBout },
      ],
    },
    registrations: { rows: [{ id: 'reg-blue', status: 'disqualified' }] },
    tournament_penalty_reviews: seed.reviewsFault
      ? { data: null, error: { message: 'connection lost' } }
      : { rows: seed.reviews ?? [] },
    phases: { rows: [{ id: 'phase-1', tournament_id: 'tournament-1' }] },
    tournaments: {
      rows: [{ id: 'tournament-1', event_id: 'event-1', penalty_ruleset_id: 'ruleset-1' }],
    },
    events: {
      rows: [{ id: 'event-1', organization_id: 'org-1', status: seed.eventStatus ?? 'running' }],
    },
    platform_roles: { rows: [] },
  });
  const scoring = {
    recomputeMatchScore: vi.fn().mockResolvedValue({ redScore: 2, blueScore: 1 }),
    assertCorrectionLands: vi.fn().mockResolvedValue(undefined),
  };
  const service = new PenaltiesService(
    db as never,
    scoring as never,
    new FrozenResultsGuard(db as never, {} as never),
    undefined,
    new MatchForfeitsService(db as never),
  );
  const undo = (cardId = 'card-black', actor: object = { userId: SCORER }) =>
    service.voidPenalty(cardId, { reason: 'wrong fighter' }, actor);
  return { db, scoring, service, undo };
}

/** The tables written, in order. */
const written = (db: { writes: { table: string }[] }) => db.writes.map((write) => write.table);

describe('PenaltiesService.voidPenalty: a black card that ended its bout', () => {
  it('takes the forfeit back, then the card', async () => {
    const { db, scoring, undo } = setup();

    await undo();

    // The review's delete is last: it is asked for once the card is voided.
    expect(written(db)).toEqual([
      'matches',
      'registrations',
      'match_forfeits',
      'match_penalties',
      'tournament_penalty_reviews',
    ]);
    const [bout] = writesTo(db, 'matches');
    expect(bout?.row).toMatchObject(BEFORE_THE_CARD);
    expect(scopedTo(bout, 'id')).toBe('m1');
    const [stamp] = writesTo(db, 'match_forfeits');
    expect(stamp?.row).toMatchObject({ voided_by_user_id: SCORER });
    expect(scopedTo(stamp, 'id')).toBe('forfeit-1');
    const [card] = writesTo(db, 'match_penalties');
    expect(card?.row).toMatchObject({ voided: true, voided_reason: 'wrong fighter' });
    expect(scopedTo(card, 'id')).toBe('card-black');
    expect(scoring.recomputeMatchScore).toHaveBeenCalledWith('m1');
  });

  it('puts the Fighter back in: the status the forfeit found', async () => {
    const { db, undo } = setup();

    await undo();

    const [fighter] = writesTo(db, 'registrations');
    expect(fighter?.row).toEqual({ status: 'confirmed' });
    expect(scopedTo(fighter, 'id')).toBe('reg-blue');
  });

  it('a scorekeeper’s PIN session takes it back too, and signs the void', async () => {
    const { db, undo } = setup();

    await undo('card-black', { staffAccountId: 'staff-1' });

    expect(writesTo(db, 'match_forfeits')[0]?.row).toMatchObject({
      voided_by_user_id: null,
      voided_by_staff_account_id: 'staff-1',
    });
    expect(writesTo(db, 'match_penalties')).toHaveLength(1);
  });

  it('asks whether the correction lands before the forfeit is touched (ruling 226)', async () => {
    const { db, scoring, undo } = setup();
    const refusal = new ConflictException({ code: 'correction_later_bout_fought' });
    scoring.assertCorrectionLands.mockRejectedValueOnce(refusal);

    await expect(undo()).rejects.toBe(refusal);
    expect(db.writes).toEqual([]);
  });

  it('reads the forfeit of THIS bout, THIS Fighter, made by a black card, still live', async () => {
    const { db, undo } = setup();

    await undo();

    expect(selectsFor(db.from, 'match_forfeits')[0]).toBe('id, replacement_registration_id');
    // The first read of the table is the leaf's; the forfeit service's follow.
    expect(filtersFor(db.from, 'match_forfeits', 'eq').slice(0, 2)).toEqual([
      ['match_id', 'm1'],
      ['forfeiting_registration_id', 'reg-blue'],
    ]);
    expect(filtersFor(db.from, 'match_forfeits', 'in')[0]).toEqual([
      'reason',
      ['black_card_1', 'black_card_2'],
    ]);
    expect(filtersFor(db.from, 'match_forfeits', 'is')[0]).toEqual(['voided_at', null]);
    expect(selectsFor(db.from, 'tournament_penalty_reviews')[0]).toBe('id');
    expect(filtersFor(db.from, 'tournament_penalty_reviews', 'eq').slice(0, 3)).toEqual([
      ['tournament_id', 'tournament-1'],
      ['registration_id', 'reg-blue'],
      ['status', 'confirmed'],
    ]);
    // The card itself is never counted among "the others".
    expect(filtersFor(db.from, 'match_penalties', 'neq')[0]).toEqual(['id', 'card-black']);
  });
});

describe('PenaltiesService.voidPenalty: a black card that cannot be taken back whole', () => {
  it.each<[string, Seed]>([
    ['a reserve took the Fighter’s place', { forfeit: { replacement_registration_id: 'reg-9' } }],
    [
      'an organiser confirmed the second black card review',
      {
        reviews: [
          {
            id: 'review-1',
            tournament_id: 'tournament-1',
            registration_id: 'reg-blue',
            review_type: 'second_black_card',
            status: 'confirmed',
          },
        ],
      },
    ],
    [
      'a bout this one feeds was fought',
      {
        forfeit: { downstream_match_ids: ['m2'] },
        laterBout: { status: 'completed', started_at: '2026-10-06T10:30:00.000Z' },
      },
    ],
    ['the bout was fought again since', { bout: { end_reason: 'first_to_points' } }],
  ])('refuses when %s, and writes nothing', async (_why, seed) => {
    const { db, scoring, undo } = setup(seed);

    const refusal = await undo().catch((err: unknown) => err);

    expect(refusal).toBeInstanceOf(ConflictException);
    expect((refusal as ConflictException).getResponse()).toMatchObject(REFUSED);
    expect(db.writes).toEqual([]);
    expect(scoring.recomputeMatchScore).not.toHaveBeenCalled();
  });

  it('a review of ANOTHER Fighter, or one still pending, refuses nothing', async () => {
    const review = { tournament_id: 'tournament-1', review_type: 'second_black_card' };
    const { db, undo } = setup({
      reviews: [
        { ...review, id: 'review-1', registration_id: 'reg-red', status: 'confirmed' },
        { ...review, id: 'review-2', registration_id: 'reg-blue', status: 'pending' },
      ],
    });

    await undo();

    expect(writesTo(db, 'match_penalties')).toHaveLength(1);
  });

  it('on an over Event the Event’s refusal comes first', async () => {
    const { db, undo } = setup({ eventStatus: 'archived' });

    await expect(undo()).rejects.toEqual(
      new ConflictException({ message: 'Event results are frozen', code: 'event_results_frozen' }),
    );
    expect(db.writes).toEqual([]);
  });
});

describe('PenaltiesService.voidPenalty: a card whose void leaves the forfeit alone', () => {
  it('a yellow card on a forfeited bout', async () => {
    const { db, undo } = setup({
      cards: [blackCard(), blackCard({ id: 'card-yellow', card: 'yellow' })],
    });

    await undo('card-yellow');

    expect(written(db)).toEqual(['match_penalties']);
  });

  it('a black card beside another live black card of the same Fighter on the bout', async () => {
    const { db, undo } = setup({ cards: [blackCard(), blackCard({ id: 'card-black-2' })] });

    await undo('card-black-2');

    expect(written(db)).toEqual(['match_penalties', 'tournament_penalty_reviews']);
  });

  it('a voided black card beside it does not count', async () => {
    const { db, undo } = setup({
      cards: [blackCard(), blackCard({ id: 'card-old', voided: true })],
    });

    await undo();

    expect(writesTo(db, 'match_forfeits')).toHaveLength(1);
  });

  it('a black card with no forfeit on its bout', async () => {
    const { db, undo } = setup({ forfeit: null });

    await undo();

    expect(written(db)).toEqual(['match_penalties', 'tournament_penalty_reviews']);
  });
});

describe('PATCH match-penalties/:id/void: the route the pad’s undo calls', () => {
  // Who may score is the route's own bar, held by its door tests. This holds
  // the hand-over: the caller that bar answered is the one who voids the forfeit.
  it('hands the caller "who may score" answered to the forfeit’s void', async () => {
    const { db, service } = setup();
    const staff = {
      authorizePenaltyScoring: vi.fn().mockResolvedValue({ staffAccountId: 'pad-7' }),
    };
    const controller = new PenaltiesController(service, db as never, staff as never, {} as never);
    const req = { headers: {} };

    await controller.voidPenalty('card-black', { reason: 'wrong fighter' }, req as never);

    expect(staff.authorizePenaltyScoring).toHaveBeenCalledWith(req, 'card-black');
    expect(writesTo(db, 'match_forfeits')[0]?.row).toMatchObject({
      voided_by_staff_account_id: 'pad-7',
    });
  });
});

describe('PenaltiesService.voidPenalty: the second black card review', () => {
  const pending = {
    id: 'review-1',
    tournament_id: 'tournament-1',
    registration_id: 'reg-blue',
    review_type: 'second_black_card',
    status: 'pending',
  };

  it('is removed when fewer than two black cards remain, and only while pending', async () => {
    const { db, undo } = setup({ reviews: [pending] });

    await undo();

    const [removed] = writesTo(db, 'tournament_penalty_reviews');
    expect(removed?.op).toBe('delete');
    expect(scopedTo(removed, 'tournament_id')).toBe('tournament-1');
    expect(scopedTo(removed, 'registration_id')).toBe('reg-blue');
    expect(scopedTo(removed, 'status')).toBe('pending');
  });

  it('stays while two black cards of that Fighter remain in the Tournament', async () => {
    const elsewhere = { match_id: 'm7' };
    const { db, undo } = setup({
      cards: [
        blackCard(),
        blackCard({ id: 'card-a', ...elsewhere }),
        blackCard({ id: 'card-b', ...elsewhere }),
      ],
      reviews: [pending],
    });

    await undo();

    expect(writesTo(db, 'tournament_penalty_reviews')).toEqual([]);
  });

  it('a review that cannot be removed does not fail a void that landed', async () => {
    const { db, scoring, undo } = setup({ forfeit: null, reviewsFault: true });

    await expect(undo()).resolves.toMatchObject({ id: 'card-black' });
    expect(writesTo(db, 'match_penalties')).toHaveLength(1);
    expect(scoring.recomputeMatchScore).toHaveBeenCalledWith('m1');
  });

  it('is not touched by a yellow card’s void', async () => {
    const { db, undo } = setup({
      cards: [blackCard({ id: 'card-yellow', card: 'yellow' })],
      forfeit: null,
      reviews: [pending],
    });

    await undo('card-yellow');

    expect(writesTo(db, 'tournament_penalty_reviews')).toEqual([]);
  });
});
