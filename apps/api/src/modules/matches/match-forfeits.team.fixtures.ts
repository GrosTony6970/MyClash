/**
 * The harness of the team forfeit tests (`match-forfeits.team.test.ts`,
 * `match-forfeits.team-retry.test.ts`): a team forfeits one Match as a whole (ADR-022; calls 1, 4,
 * 8 and 13 of the 1b-2 plan).
 *
 * The bout of Lyon Blades (red) against Paris Rapiers (blue), in a Pool, under a ruleset whose
 * voluntary forfeit is a loss of 0 to 9 that withdraws a Fighter: a team is withdrawn by nothing.
 * The status settle is the real one: a settle would call the database (`settle_fighter_status`),
 * which this double does not answer.
 */
import { vi } from 'vitest';
import { CLUB_START_FORFEIT_RULES, type ForfeitRules } from '@myclash/types/forfeit-rules';
import {
  mockSupabase,
  scopedTo,
  supabaseChain,
  writesTo,
  type SupabaseRow,
} from '../../common/testing/supabase-chain';
import { fighterStatusOver } from './fighter-status.fixtures';
import { MatchForfeitsService } from './match-forfeits.service';

export const RULES: ForfeitRules = {
  ...CLUB_START_FORFEIT_RULES,
  reasons: {
    ...CLUB_START_FORFEIT_RULES.reasons,
    voluntary: { outcome: 'fixed_loss', opponentScore: 9, fighter: 'withdrawn' },
  },
  disqualifyAfter: 1,
  disqualifyBeforeFirstBout: true,
};

const TEAM_BOUT = {
  id: 'm1',
  phase_id: 'phase-1',
  pool_id: 'pool-1',
  bracket_slot_id: null,
  status: 'running',
  locked_at: null,
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
};

export const MATCH_SELECT = '*, phases(id, type, tournament_id, config_json)';
export const SNAPSHOT_SELECT =
  'status, red_score, blue_score, winner_registration_id, winner_team_id, ended_at, end_reason';
export const BOUT_SIDE_SELECT =
  'id, status, red_registration_id, red_team_id, blue_registration_id, blue_team_id';

/** The built-in penalty ruleset, with `rules` as its forfeit rules. */
export const builtIn = (rules: ForfeitRules) => ({
  rows: [
    {
      id: 'built-in',
      built_in: true,
      owner_organization_id: null,
      first_black_card_forfeit: 'match',
      second_black_card_forfeit: 'tournament',
      forfeit_rules: rules,
    },
  ],
});

interface Setup {
  bout?: Record<string, unknown>;
  phaseType?: string;
  history?: Record<string, unknown>[];
  /** The Tournament's own changes of the forfeit rules (`tournaments.forfeit_rules`). */
  changes?: Record<string, unknown> | null;
  more?: Record<string, { rows: SupabaseRow[] }>;
  withoutCompletion?: boolean;
}

const tablesOf = (setup: Setup) => ({
  matches: {
    rows: [
      {
        ...TEAM_BOUT,
        ...setup.bout,
        phases: {
          id: 'phase-1',
          type: setup.phaseType ?? 'pool',
          tournament_id: 'tournament-1',
          config_json: {},
        },
      },
    ],
  },
  match_forfeits: {
    rows: setup.history ?? [],
    returning: (row: SupabaseRow) => ({ id: `ff-${String(row['match_id'])}` }),
  },
  tournaments: {
    rows: [
      {
        id: 'tournament-1',
        event_id: 'event-1',
        penalty_ruleset_id: null,
        forfeit_rules: setup.changes ?? null,
      },
    ],
  },
  events: { rows: [{ id: 'event-1', penalty_ruleset_id: null }] },
  penalty_rulesets: builtIn(RULES),
  ...setup.more,
});

/** The team bout, its service, and the completion owner's two doors as spies. */
export function teamBout(setup: Setup = {}) {
  const db = mockSupabase(tablesOf(setup));
  const completion = {
    onMatchCompleted: vi.fn(async (_matchId: string) => undefined),
    onBoutPutBack: vi.fn(async (_matchId: string) => undefined),
  };
  const service = new MatchForfeitsService(
    db as never,
    setup.withoutCompletion ? undefined : (completion as never),
    undefined,
    undefined,
    undefined,
    undefined,
    fighterStatusOver(db),
  );
  const forfeit = (body: Record<string, unknown> = {}) =>
    service.createForfeit('m1', { forfeitingTeamId: 'team-red', reason: 'voluntary', ...body });
  return { db, service, completion, forfeit };
}

type Db = ReturnType<typeof teamBout>['db'];

export const written = (db: Db, table: string, op: 'insert' | 'update') =>
  writesTo(db, table)
    .filter((write) => write.op === op)
    .map((write) => write.row as Record<string, unknown>);

/** The writes that kept a record's result (`stampResultingState`). */
export const stamped = (db: Db, forfeitId: string) =>
  writesTo(db, 'match_forfeits').filter(
    (write) =>
      write.op === 'update' &&
      scopedTo(write, 'id') === forfeitId &&
      Object.hasOwn(write.row as object, 'resulting_match_state'),
  );

/** The database refuses the first update of `table`, and only that one. */
export function refuseFirstUpdate(db: Db, table: string) {
  const seeded = db.from.getMockImplementation()!;
  let refused = false;
  db.from.mockImplementation((name: string) => {
    const chain = seeded(name);
    if (name !== table || refused) return chain;
    chain.update = vi.fn(() => {
      refused = true;
      return supabaseChain({ data: null, error: { message: 'a lock' } });
    }) as never;
    return chain;
  });
}

/** The record a first send inserted, as the database keeps it. */
export const kept = (db: Db) => ({
  ...written(db, 'match_forfeits', 'insert')[0],
  id: 'ff-m1',
  voided_at: null,
  resulting_match_state: {},
});
