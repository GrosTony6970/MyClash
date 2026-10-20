import { vi } from 'vitest';
import { mockSupabase, type TableSeed } from '../../common/testing/supabase-chain';
import { FrozenResultsGuard } from '../matches/frozen-results.guard';
import { MatchForfeitsService } from '../matches/match-forfeits.service';
import type { BlackCardEffect } from '@myclash/rulesets';
import { CLUB_START_FORFEIT_RULES, type ForfeitRules } from '@myclash/types/forfeit-rules';
import { PenaltiesService } from './penalties.service';

/** The seeded bout of `penalties.void-black-card*.test.ts`: a black card, its forfeit, its Fighter. */
export const SCORER = 'a0000000-0000-4000-8000-000000000001';
/** No role in the club: on an over Event the corrections are this account's (ruling 251). */
export const SUPER_ADMIN = 'a0000000-0000-4000-8000-000000000002';
export const REFUSED = { code: 'black_card_undo_refused' };

export const BEFORE_THE_CARD = {
  status: 'running',
  red_score: 2,
  blue_score: 1,
  winner_registration_id: null,
  ended_at: null,
  end_reason: null,
};
export const AFTER_THE_CARD = {
  status: 'completed',
  red_score: 5,
  blue_score: 0,
  winner_registration_id: 'reg-red',
  ended_at: '2026-10-06T10:00:00.000Z',
  end_reason: 'black_card',
};

export type Rows = Record<string, unknown>[];

export interface Seed {
  cards?: Rows;
  forfeit?: Record<string, unknown> | null;
  otherForfeits?: Rows;
  bout?: Record<string, unknown>;
  laterBout?: Record<string, unknown>;
  reviews?: Rows;
  /** Every call on the reviews table answers an error. */
  reviewsFault?: boolean;
  eventStatus?: string;
  /** Opt-in: a card sent through the real forfeit path (`penalties.card-effect.test.ts`). */
  cardPath?: CardPath;
}

/**
 * The card path: the bout is a Pool bout still running, the Tournament pins card rules
 * `CARD_RULES`, and the Fighter's later Pool bout waits. The void tests seed the bout after its
 * card, so this is opt-in.
 */
export interface CardPath {
  /** What a 1st and a 2nd black card do under the Tournament's card rules of now. */
  first: BlackCardEffect;
  second: BlackCardEffect;
  /** What its penalty ruleset's forfeit rules change over a new club ruleset's. */
  forfeitRules?: Partial<ForfeitRules>;
  /** The Tournament's pin, `CARD_RULES` unless a story names a pin no row holds. */
  pin?: string;
  /** The Tournament's own changes of those rules (`tournaments.forfeit_rules`, ruling 65). */
  changes?: Record<string, unknown>;
}

export const CARD_RULES = 'cards-now';

export const blackCard = (over: Record<string, unknown> = {}) => ({
  id: 'card-black',
  match_id: 'm1',
  tournament_id: 'tournament-1',
  registration_id: 'reg-blue',
  card: 'black',
  voided: false,
  ...over,
});

export const FORFEIT = {
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
  tournament_id: 'tournament-1',
  created_at: '2026-10-06T10:00:00.000Z',
};
/** Another live forfeit of the same Fighter, on another bout, made an hour later. */
export const otherForfeit = (over: Record<string, unknown> = {}) => ({
  ...FORFEIT,
  id: 'forfeit-2',
  match_id: 'm7',
  reason: 'injury',
  created_at: '2026-10-06T11:00:00.000Z',
  ...over,
});
export const BOUT = {
  id: 'm1',
  phase_id: 'phase-1',
  locked_at: null,
  current_round: 1,
  red_registration_id: 'reg-red',
  blue_registration_id: 'reg-blue',
  ...AFTER_THE_CARD,
  match_rules: { penalty_ruleset_id: 'ruleset-1' },
};
export const LATER_BOUT = { id: 'm2', status: 'scheduled', started_at: null };

/** The embed "who may score" and the forfeit read the bout through: a Pool phase, on the card path. */
function phaseOf(path: CardPath | undefined, event: Record<string, unknown>) {
  const tournaments = {
    id: 'tournament-1',
    event_id: 'event-1',
    lock_config_json: null,
    events: event,
  };
  if (!path) return { tournaments };
  return { id: 'phase-1', type: 'pool', tournament_id: 'tournament-1', tournaments };
}

/** The bout and the Fighter's later bout, both of one Pool on the card path. */
function boutRows(seed: Seed, phases: object) {
  const pool = seed.cardPath ? { ...BEFORE_THE_CARD, pool_id: 'pool-1' } : {};
  const later = seed.cardPath
    ? { pool_id: 'pool-1', red_registration_id: 'reg-green', blue_registration_id: 'reg-blue' }
    : {};
  return [
    { ...BOUT, phases, ...pool, ...seed.bout },
    { ...LATER_BOUT, ...later, ...seed.laterBout },
  ];
}

/** What the card path reads beyond the void's, and the read-backs of its writes (none applied). */
function cardPathTables(path: CardPath | undefined): Record<string, TableSeed> {
  if (!path) return {};
  const cardRules = {
    id: CARD_RULES,
    yellow_card_points: 0,
    red_card_points: -1,
    black_card_points: 0,
    first_black_card_forfeit: path.first,
    second_black_card_forfeit: path.second,
    forfeit_rules: { ...CLUB_START_FORFEIT_RULES, ...path.forfeitRules },
  };
  return {
    penalty_rulesets: { rows: [cardRules] },
    match_events: { rows: [] },
    tournaments: {
      rows: [
        {
          id: 'tournament-1',
          event_id: 'event-1',
          penalty_ruleset_id: path.pin ?? CARD_RULES,
          forfeit_rules: path.changes ?? null,
        },
      ],
    },
  };
}

/** A written row read back with the id a database gives it. */
const stamped = (path: CardPath | undefined, id: (row: Record<string, unknown>) => string) =>
  path ? { returning: (row: Record<string, unknown>) => ({ id: id(row) }) } : {};

export function setup(seed: Seed = {}) {
  const event = { organization_id: 'org-1', status: seed.eventStatus ?? 'running' };
  const path = seed.cardPath;
  const db = mockSupabase({
    match_penalties: { rows: seed.cards ?? [blackCard()], ...stamped(path, () => 'card-new') },
    match_forfeits: {
      rows: [
        ...(seed.forfeit === null ? [] : [{ ...FORFEIT, ...seed.forfeit }]),
        ...(seed.otherForfeits ?? []),
      ],
      ...stamped(path, (row) => `forfeit-${String(row['match_id'])}`),
    },
    matches: { rows: boutRows(seed, phaseOf(path, event)) },
    registrations: { rows: [{ id: 'reg-blue', status: path ? 'checked_in' : 'disqualified' }] },
    tournament_penalty_reviews: seed.reviewsFault
      ? { data: null, error: { message: 'connection lost' } }
      : { rows: seed.reviews ?? [] },
    phases: { rows: [{ id: 'phase-1', tournament_id: 'tournament-1' }] },
    tournaments: { rows: [{ id: 'tournament-1', event_id: 'event-1' }] },
    events: { rows: [{ id: 'event-1', ...event }] },
    platform_roles: { rows: [{ user_id: SUPER_ADMIN, role: 'super_admin' }] },
    ...cardPathTables(path),
  });
  const scoring = {
    recomputeMatchScore: vi.fn().mockResolvedValue({ redScore: 2, blueScore: 1 }),
    assertCorrectionLands: vi.fn().mockResolvedValue(undefined),
  };
  const forfeits = new MatchForfeitsService(db as never);
  const service = new PenaltiesService(
    db as never,
    scoring as never,
    new FrozenResultsGuard(db as never, {} as never),
    undefined,
    forfeits,
  );
  const undo = (cardId = 'card-black', actor: object = { userId: SCORER }) =>
    service.voidPenalty(cardId, { reason: 'wrong fighter' }, actor);
  return { db, scoring, service, forfeits, undo };
}

/** The tables written, in order. */
export const written = (db: { writes: { table: string }[] }) =>
  db.writes.map((write) => write.table);
