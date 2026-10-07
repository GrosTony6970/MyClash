import { vi } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { FrozenResultsGuard } from '../matches/frozen-results.guard';
import { MatchForfeitsService } from '../matches/match-forfeits.service';
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
}

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
};
export const LATER_BOUT = { id: 'm2', status: 'scheduled', started_at: null };

export function setup(seed: Seed = {}) {
  const event = { organization_id: 'org-1', status: seed.eventStatus ?? 'running' };
  // The embed "who may score" reads the bout through, beside the flat tables below.
  const phases = {
    tournaments: { id: 'tournament-1', event_id: 'event-1', lock_config_json: null, events: event },
  };
  const db = mockSupabase({
    match_penalties: { rows: seed.cards ?? [blackCard()] },
    match_forfeits: {
      rows: [
        ...(seed.forfeit === null ? [] : [{ ...FORFEIT, ...seed.forfeit }]),
        ...(seed.otherForfeits ?? []),
      ],
    },
    matches: {
      rows: [
        { ...BOUT, phases, ...seed.bout },
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
    events: { rows: [{ id: 'event-1', ...event }] },
    platform_roles: { rows: [{ user_id: SUPER_ADMIN, role: 'super_admin' }] },
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
export const written = (db: { writes: { table: string }[] }) =>
  db.writes.map((write) => write.table);
