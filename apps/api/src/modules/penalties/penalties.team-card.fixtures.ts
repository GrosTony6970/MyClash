/**
 * The harness of the team card tests (`penalties.team-card.test.ts`,
 * `penalties.team-card-retry.test.ts`): a card on a team names the team (ADR-022, call 5), a team
 * black card loses this Match only (ruling 972), and a team's card count starts fresh every Match
 * (ruling 976).
 *
 * The Pool bout of Lyon Blades (red) against Paris Rapiers (blue). A real `PenaltiesService` over a
 * real `MatchForfeitsService`, on one database double that applies no write: a row "of before" is
 * seeded. The penalty list counts repeats over the Tournament, and its black card reaches nothing
 * (`first_black_card_forfeit: 'none'`): what a team black card does is ruling 972's, not the
 * list's. Its black card forfeit is a loss of 0 to 7.
 */
import { vi } from 'vitest';
import { CLUB_START_FORFEIT_RULES } from '@myclash/types/forfeit-rules';
import { mockSupabase, writesTo, type SupabaseRow } from '../../common/testing/supabase-chain';
import { fighterStatusDouble } from '../matches/fighter-status.fixtures';
import { MatchForfeitsService } from '../matches/match-forfeits.service';
import { PenaltiesService } from './penalties.service';

export const TEAM_BOUT = {
  id: 'm1',
  phase_id: 'phase-1',
  pool_id: 'pool-1',
  bracket_slot_id: null,
  status: 'running',
  locked_at: null,
  current_round: 1,
  awaiting_round_advance: false,
  red_registration_id: null,
  blue_registration_id: null,
  red_team_id: 'team-red',
  blue_team_id: 'team-blue',
  winner_registration_id: null,
  winner_team_id: null,
  red_score: 2,
  blue_score: 3,
  ended_at: null,
  end_reason: null,
  match_rules: { penalty_ruleset_id: 'cards' },
  phases: { id: 'phase-1', type: 'pool', tournament_id: 'tournament-1', config_json: {} },
};

/** The bout as the team black card left it: the red team lost it, 0 to 7. */
export const ENDED_BY_THE_CARD = {
  status: 'completed',
  winner_team_id: 'team-blue',
  red_score: 0,
  blue_score: 7,
  ended_at: '2026-11-25T10:00:00.000Z',
  end_reason: 'black_card',
};

export const CARDS = {
  id: 'cards',
  built_in: false,
  owner_organization_id: 'org-1',
  accumulation_scope: 'tournament',
  yellow_card_points: -1,
  red_card_points: -2,
  black_card_points: 0,
  first_black_card_forfeit: 'none',
  second_black_card_forfeit: 'none',
  forfeit_rules: { ...CLUB_START_FORFEIT_RULES, blackCardOpponentScore: 7 },
};

/** "Leaving the piste": a yellow the first time, a red after. */
export const LEAVING = {
  id: 'entry-leaving',
  group_number: 4,
  ref_number: '4',
  sanctions: ['yellow', 'red'],
};

/** A live yellow for leaving the piste, given to the red team in bout `matchId`. */
export const leftThePiste = (matchId: string) => ({
  id: `card-${matchId}`,
  client_uuid: `uuid-${matchId}`,
  match_id: matchId,
  tournament_id: 'tournament-1',
  registration_id: null,
  team_id: 'team-red',
  source: 'ruleset',
  group_number: 4,
  card: 'yellow',
  voided: false,
});

interface Setup {
  bout?: Record<string, unknown>;
  cards?: SupabaseRow[];
  forfeits?: SupabaseRow[];
  /** The Tournament's own changes of the forfeit rules (`tournaments.forfeit_rules`). */
  changes?: Record<string, unknown> | null;
  /** What the list's forfeit rules change over the fixture's. */
  forfeitRules?: Record<string, unknown>;
}

const tablesOf = (setup: Setup) => ({
  matches: { rows: [{ ...TEAM_BOUT, ...setup.bout }] },
  phases: { rows: [{ id: 'phase-1', tournament_id: 'tournament-1' }] },
  tournaments: {
    rows: [
      {
        id: 'tournament-1',
        event_id: 'event-1',
        penalty_ruleset_id: 'cards',
        forfeit_rules: setup.changes ?? null,
      },
    ],
  },
  events: { rows: [{ id: 'event-1', organization_id: 'org-1', penalty_ruleset_id: null }] },
  penalty_rulesets: {
    rows: [{ ...CARDS, forfeit_rules: { ...CARDS.forfeit_rules, ...setup.forfeitRules } }],
  },
  penalty_ruleset_entries: { rows: [LEAVING] },
  match_penalties: { rows: setup.cards ?? [], returning: { id: 'card-new' } },
  match_forfeits: {
    rows: setup.forfeits ?? [],
    returning: (row: SupabaseRow) => ({ id: `ff-${String(row['match_id'])}` }),
  },
  match_events: { rows: [] },
  tournament_penalty_reviews: { rows: [] },
});

/** The team bout, both services, the status settle and the completion owner's doors as spies. */
export function teamCardBout(setup: Setup = {}) {
  const db = mockSupabase(tablesOf(setup));
  const completion = {
    onMatchCompleted: vi.fn(async (_matchId: string) => undefined),
    onBoutPutBack: vi.fn(async (_matchId: string) => undefined),
  };
  const scoring = {
    recomputeMatchScore: vi.fn().mockResolvedValue({ redScore: 2, blueScore: 3 }),
    assertCorrectionLands: vi.fn().mockResolvedValue(undefined),
  };
  const status = fighterStatusDouble();
  const forfeits = new MatchForfeitsService(
    db as never,
    completion as never,
    undefined,
    undefined,
    undefined,
    undefined,
    status,
  );
  const service = new PenaltiesService(
    db as never,
    scoring as never,
    undefined,
    undefined,
    forfeits,
    undefined,
    status,
  );
  /** A card the tablet sends: to the red team unless the body names another side. */
  const send = (body: Record<string, unknown>) =>
    service.createPenalty(
      'm1',
      {
        clientUuid: 'card-uuid',
        sequence: 1,
        teamId: 'team-red',
        occurredAt: '2026-11-25T10:00:00.000Z',
        ...body,
      } as never,
      { staffAccountId: 'staff-1' },
    );
  return { db, completion, status, service, send };
}

type Db = ReturnType<typeof teamCardBout>['db'];

export const BLACK_CARD = { directCard: 'black', reason: 'brutality' };

export const written = (db: Db, table: string, op: 'insert' | 'update') =>
  writesTo(db, table)
    .filter((write) => write.op === op)
    .map((write) => write.row as Record<string, unknown>);

/** When the database saved the card (`recorded_at`): before any forfeit it made. */
export const CARD_SAVED_AT = '2026-11-25T09:59:59.000Z';

/** The card a first send inserted, as the database keeps it. */
export const keptCard = (db: Db) => ({
  ...written(db, 'match_penalties', 'insert')[0],
  id: 'card-new',
  recorded_at: CARD_SAVED_AT,
});

/** The forfeit record a first send inserted, as the database keeps it: no result kept yet. */
export const keptForfeit = (db: Db) => ({
  ...written(db, 'match_forfeits', 'insert')[0],
  id: 'ff-m1',
  voided_at: null,
  resulting_match_state: {},
});
