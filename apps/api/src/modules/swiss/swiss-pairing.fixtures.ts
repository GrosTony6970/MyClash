/**
 * Fixtures shared by the SwissPairingService tests.
 *
 * TEST-ONLY. Named in `apps/api/tsconfig.build.json`'s exclude list, which is
 * what keeps it out of `dist/` — `scripts/check-test-code-leak.mjs` proves that
 * list is complete rather than trusting the name.
 *
 * Extracted because the pairing tests split by concern — planning a round and
 * committing one are separate files — while the phase row that answers them is
 * the same row. Duplicating it would let the two halves drift, and the phase's
 * embedded tournament is what both the config parsing and the ruleset stamp
 * read.
 */
import { DEFAULT_SWISS_POINTS, DEFAULT_SWISS_TIEBREAK_CHAIN } from './dto/swiss-config.dto';
import type { SupabaseRow } from '../../common/testing/supabase-chain';
import type { SupabaseService } from '../supabase/supabase.service';

/** The double stands in for SupabaseService; every caller casts at the seam. */
export const asSupabase = (supabase: { service: unknown }): SupabaseService =>
  supabase as unknown as SupabaseService;

export const swissConfig = (roundCount = 5) => ({
  roundCount,
  seedingStrategy: 'random',
  pairingMethod: 'fold',
  grouping: { kind: 'points' },
  rankBy: 'swissPts',
  points: { ...DEFAULT_SWISS_POINTS },
  tiebreakChain: [...DEFAULT_SWISS_TIEBREAK_CHAIN],
});

/**
 * One phase row answers all three reads the service makes of `phases`.
 *
 * `loadContext` wants the config, `matchRulesetForPhase` wants the tournament's
 * ruleset and `eventAndLices` wants its event — three selects, one row, all
 * scoped by id. A seeded table is what makes that work: a queue would have to
 * predict the order they interleave, and that order is an implementation detail
 * of the commit path.
 */
export const phaseRow = (over: SupabaseRow = {}): SupabaseRow => ({
  id: 'p1',
  type: 'swiss',
  tournament_id: 't1',
  config_json: swissConfig(),
  tournaments: {
    event_id: 'e1',
    ruleset_code: 'Generic_PointsCap',
    // The shorthand the column is allowed to hold; the stamp canonicalises it.
    ruleset_version: '1',
    ruleset_content_hash: 'hash-1',
  },
  ...over,
});

/** Another Swiss phase, in another tournament. Nothing here belongs to p1. */
export const OTHER_PHASE: SupabaseRow = {
  id: 'p2',
  type: 'swiss',
  tournament_id: 't2',
  config_json: swissConfig(),
  tournaments: { event_id: 'e2', ruleset_code: 'TF_v1', ruleset_version: '1.0.0' },
};

export const entrant = (
  registrationId: string,
  phaseId = 'p1',
  withdrawnAtRound: number | null = null,
): SupabaseRow => ({
  phase_id: phaseId,
  registration_id: registrationId,
  withdrawn_at_round: withdrawnAtRound,
});

/** Four entrants of p1, plus one belonging to the other phase. */
export const FIELD_OF_FOUR: SupabaseRow[] = [
  entrant('r1'),
  entrant('r2'),
  entrant('r3'),
  entrant('r4'),
  entrant('rX', 'p2'),
];

/** One bout of a recorded round, as `loadRounds` embeds them. */
export const bout = (id: string, red: string, blue: string): SupabaseRow => ({
  id,
  red_registration_id: red,
  blue_registration_id: blue,
  status: 'completed',
});

export const swissRound = (over: SupabaseRow = {}): SupabaseRow => ({
  id: 'sr-old',
  phase_id: 'p1',
  round_number: 1,
  status: 'completed',
  bye_registration_id: null,
  pairing_meta_json: null,
  matches: [],
  ...over,
});

/** The tables a plan-only call touches. */
export const readState = (over: Record<string, unknown> = {}) => ({
  phases: { rows: [phaseRow(), OTHER_PHASE] },
  swiss_entrants: { rows: FIELD_OF_FOUR },
  swiss_rounds: { rows: [] as SupabaseRow[] },
  ...over,
});
