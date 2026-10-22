import { CLUB_START_FORFEIT_RULES, type ForfeitRulesInForce } from '@myclash/types/forfeit-rules';
import {
  mockSupabase,
  scopedTo,
  writesTo,
  type ChainResult,
  type SupabaseRow,
} from '../../common/testing/supabase-chain';
import {
  fighterStatusOver,
  settleRpc,
  statusCollaborators,
  swissRpc,
  type SettleCall,
} from './fighter-status.fixtures';

/**
 * Ana (`reg-ana`) in Tournament `t1`, as the status reconcile reads her once her status is settled
 * (`fighter-reconcile.ts`): two Pool phases and a bracket, her bouts in each state, and Bob and Cy
 * beside her. A test names what holds her out (her status, her forfeits, cards, a review) and
 * reads what the reconcile wrote. The seeded double applies no write, so each test seeds the
 * state the reconcile meets, and the re-check reads the status a test queues.
 */

export const OUT_SINCE = '2026-10-21T10:00:00.000Z';
export const BEFORE_SPELL = '2026-10-21T09:00:00.000Z';
export const DURING_SPELL = '2026-10-21T11:00:00.000Z';

/** Ana's bout against `other` in `phase`, she on red unless `blue`. */
export const bout = (
  id: string,
  phase: string,
  status: string,
  opts: { blue?: boolean; other?: string; red_score?: number; blue_score?: number } = {},
): SupabaseRow => ({
  id,
  phase_id: phase,
  red_registration_id: opts.blue ? (opts.other ?? 'reg-bob') : 'reg-ana',
  blue_registration_id: opts.blue ? 'reg-ana' : (opts.other ?? 'reg-bob'),
  red_score: opts.red_score ?? 0,
  blue_score: opts.blue_score ?? 0,
  status,
  winner_registration_id: null,
  ended_at: null,
  end_reason: null,
});

/** Her bouts: one of each state in the first Pool, a paused one in the second, a bracket one. */
export const ANA_BOUTS = [
  bout('m-scheduled', 'pool-1', 'scheduled'),
  bout('m-running', 'pool-1', 'running'),
  bout('m-done', 'pool-1', 'completed'),
  bout('m-paused', 'pool-2', 'paused', {
    blue: true,
    other: 'reg-cy',
    red_score: 2,
    blue_score: 1,
  }),
  bout('m-bracket', 'bracket', 'scheduled'),
  { ...bout('m-not-hers', 'pool-1', 'scheduled'), red_registration_id: 'reg-cy' },
];

export const PHASES = [
  { id: 'pool-1', tournament_id: 't1', type: 'pool' },
  { id: 'pool-2', tournament_id: 't1', type: 'pool' },
  { id: 'bracket', tournament_id: 't1', type: 'single_elim' },
];

/** A forfeit record of Ana's in `t1`. */
export const forfeit = (id: string, over: SupabaseRow): SupabaseRow => ({
  id,
  tournament_id: 't1',
  forfeiting_registration_id: 'reg-ana',
  under_out_status: false,
  reason: 'injury',
  fighter_outcome: null,
  parent_forfeit_id: null,
  auto_created: false,
  voided_at: null,
  voided_by_return: false,
  previous_match_state: { status: 'scheduled', red_score: 0, blue_score: 0 },
  resulting_match_state: {},
  created_at: '2026-10-21T09:30:00.000Z',
  ...over,
});

/** The rules in force: a new club ruleset's, with `over` on top. */
export const rulesInForce = (over: Partial<ForfeitRulesInForce> = {}): ForfeitRulesInForce => ({
  ...CLUB_START_FORFEIT_RULES,
  firstBlackCard: 'match',
  secondBlackCard: 'tournament',
  ...over,
});

/** Ana's row, as her settle leaves it. */
export const anaRow = (status: string): SupabaseRow => ({
  id: 'reg-ana',
  tournament_id: 't1',
  status,
  out_since: status === 'withdrawn' || status === 'disqualified' ? OUT_SINCE : null,
});

/** Ana as the registrations read finds her, once per read when `statuses` names several. */
export function anaRead(statuses: string[]): ChainResult[] {
  return statuses.map((status) => ({ data: [anaRow(status)], error: null }));
}

export interface PoolSeed {
  /**
   * Her status, read after the settle and again after the bouts followed it: one status is her
   * row (a seeded table, beside `others`); several are a queue of reads, one per read.
   */
  statuses: string[];
  /** The other Fighters' rows (the opponents of a bout put back). */
  others?: SupabaseRow[];
  /** Replaces the whole `registrations` seed: a queue of reads, for a status that moves. */
  registrationsTable?: ChainResult[];
  forfeits?: SupabaseRow[];
  bouts?: SupabaseRow[];
  cards?: SupabaseRow[];
  reviews?: SupabaseRow[];
  /** Replaces the whole `match_forfeits` seed (a queue, for a write the database refuses). */
  forfeitsTable?: ChainResult[];
  /** Replaces the whole `matches` seed, for the same reason. */
  matchesTable?: ChainResult[];
  eventOpen?: boolean;
  /** Her phases, when not `PHASES`: a Swiss phase, for one. */
  phases?: SupabaseRow[];
  /** Her Swiss entries (none unless named). */
  swissEntrants?: SupabaseRow[];
  /** The Swiss phases `swiss_phase_over` answers as over. */
  over?: string[];
  /** More tables: the rules in force, for a door that reads them itself (a Swiss reopen). */
  extra?: Record<string, { rows: SupabaseRow[] }>;
}

/** The real status service over Ana's Tournament, and what it wrote. */
export function anasTournament(seed: PoolSeed) {
  let next = 0;
  const calls: SettleCall[] = [];
  /** The Swiss functions the reconcile called, each with the writes made before it. */
  const swissCalls: SettleCall[] = [];
  const db = mockSupabase(
    {
      registrations:
        seed.registrationsTable ??
        (seed.statuses.length === 1
          ? { rows: [anaRow(seed.statuses[0]!), ...(seed.others ?? [])] }
          : anaRead(seed.statuses)),
      phases: { rows: seed.phases ?? PHASES },
      matches: seed.matchesTable ?? { rows: seed.bouts ?? ANA_BOUTS },
      match_forfeits: seed.forfeitsTable ?? {
        rows: seed.forfeits ?? [],
        returning: () => ({ id: `new-${++next}` }),
      },
      match_penalties: { rows: seed.cards ?? [] },
      tournament_penalty_reviews: { rows: seed.reviews ?? [] },
      swiss_entrants: { rows: seed.swissEntrants ?? [] },
      ...seed.extra,
    },
    {
      ...settleRpc(calls, () => db.writes, {
        data: { before: 'checked_in', after: seed.statuses[0] },
        error: null,
      }),
      ...swissRpc(swissCalls, () => db.writes, seed.over),
    },
  );
  const deps = statusCollaborators({ eventOpen: seed.eventOpen });
  const service = fighterStatusOver(db, deps);
  const settle = (over: Record<string, unknown> = {}) =>
    service.settle({
      registrationId: 'reg-ana',
      tournamentId: 't1',
      rules: rulesInForce(),
      actor: { userId: 'user-org' },
      ...over,
    });
  return { db, deps, calls, swissCalls, service, settle };
}

type Db = ReturnType<typeof anasTournament>['db'];

/** The records the reconcile inserted, in order. */
export const inserted = (db: Db): SupabaseRow[] =>
  writesTo(db, 'match_forfeits')
    .filter((write) => write.op === 'insert')
    .map((write) => write.row as SupabaseRow);

/** The bouts the reconcile wrote, in order. */
export const boutsWritten = (db: Db): unknown[] =>
  writesTo(db, 'matches').map((write) => scopedTo(write, 'id'));

/** The records the reconcile voided, and how each was stamped. */
export const voided = (db: Db): Array<{ id: unknown; byReturn: unknown }> =>
  writesTo(db, 'match_forfeits')
    .filter((write) => write.op === 'update' && Object.hasOwn(write.row as object, 'voided_at'))
    .map((write) => ({
      id: scopedTo(write, 'id'),
      byReturn: (write.row as SupabaseRow)['voided_by_return'],
    }));
