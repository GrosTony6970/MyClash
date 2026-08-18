/**
 * Fixtures shared by the Swiss module's tests.
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
import type { RecordedWrite, SupabaseRow } from '../../common/testing/supabase-chain';
import { writesTo } from '../../common/testing/supabase-chain';
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

/**
 * `n` entrants of p1, named r1..rn, plus one belonging to the other phase.
 *
 * The foreign entrant is not decoration: every read of `swiss_entrants` is
 * scoped by phase, and a field that contains only p1 cannot tell a scoped read
 * from an unscoped one.
 */
export const fieldOf = (n: number): SupabaseRow[] => [
  ...Array.from({ length: n }, (_, i) => entrant(`r${i + 1}`)),
  entrant('rX', 'p2'),
];

/** Four entrants of p1, plus one belonging to the other phase. */
export const FIELD_OF_FOUR: SupabaseRow[] = fieldOf(4);

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

// ── The round an override edits ──────────────────────────────────────────────

/**
 * One bout of the round under edit.
 *
 * Distinct from {@link bout}, which models a bout of a round already played:
 * this one is still `scheduled` and carries the round it belongs to, because
 * `setMatchSides` reaches the round through the match.
 */
export const editableBout = (
  id: string,
  red: string | null,
  blue: string | null,
  status = 'scheduled',
): SupabaseRow => ({
  id,
  status,
  swiss_round_id: 'sr2',
  red_registration_id: red,
  blue_registration_id: blue,
});

/**
 * Round 2: four fighters, two bouts, nobody sitting out.
 *
 * `swiss_rounds` is read twice with different projections — once for the round
 * itself, once by `loadRounds` for everybody's history — so it is seeded and
 * one row answers both.
 */
export const round2 = (over: SupabaseRow = {}): SupabaseRow => ({
  id: 'sr2',
  phase_id: 'p1',
  round_number: 2,
  status: 'pending',
  bye_registration_id: null,
  pairing_meta_json: null,
  matches: [editableBout('m1', 'r1', 'r2'), editableBout('m2', 'r3', 'r4')],
  ...over,
});

/**
 * Round 1, already played. Only r1 and r4 have met.
 *
 * Deliberately one recorded bout rather than a full round: the history is here
 * to make exactly ONE of the pairings a swap creates a rematch, so a warning
 * can be attributed to the pair it names.
 */
export const ROUND_1: SupabaseRow = {
  id: 'sr1',
  phase_id: 'p1',
  round_number: 1,
  status: 'completed',
  bye_registration_id: null,
  pairing_meta_json: null,
  matches: [
    { id: 'm-old-1', status: 'completed', red_registration_id: 'r1', blue_registration_id: 'r4' },
  ],
};

export const clubbed = (registrationId: string, clubId: string | null): SupabaseRow => ({
  ...entrant(registrationId),
  registrations: { persons: { club_id: clubId } },
});

/** Four entrants, no two of them clubmates, plus one from another phase. */
export const CLUBBED_ENTRANTS: SupabaseRow[] = [
  clubbed('r1', 'club-a'),
  clubbed('r2', 'club-b'),
  clubbed('r3', 'club-c'),
  clubbed('r4', null),
  // Another phase's entrant, sharing a club with r1.
  { ...entrant('rX', 'p2'), registrations: { persons: { club_id: 'club-a' } } },
];

/** Every table an override reads or writes. */
export const overrideState = (over: Record<string, unknown> = {}) => ({
  phases: { rows: [phaseRow()] },
  swiss_entrants: { rows: CLUBBED_ENTRANTS },
  swiss_rounds: { rows: [ROUND_1, round2()] },
  matches: { rows: [editableBout('m1', 'r1', 'r2'), editableBout('m2', 'r3', 'r4')] },
  audit_log: { rows: [] as SupabaseRow[] },
  ...over,
});

// ── The organiser's Swiss view ───────────────────────────────────────

/**
 * A registration of t1, as both reads of that table see it.
 *
 * The admin view counts registrations and the seeder loads them; the two ask
 * for different columns of the same rows, so one seeded table answers both.
 */
export const registration = (id: string, over: SupabaseRow = {}): SupabaseRow => ({
  id,
  tournament_id: 't1',
  status: 'registered',
  seed: null,
  bib_number: null,
  persons: { club_id: 'club-a', global_persons: { hema_ratings_id: null } },
  ...over,
});

/**
 * An entrant carrying the name embed the admin and public views display.
 *
 * Distinct from {@link clubbed}, which carries only `club_id`: the same-club
 * warning needs the id to compare, these two surfaces need something to show.
 */
export const namedEntrant = (
  registrationId: string,
  givenName: string,
  familyName: string,
  club: { name: string; abbreviation: string | null } | null = null,
): SupabaseRow => ({
  ...entrant(registrationId),
  registrations: {
    id: registrationId,
    persons: {
      id: `person-${registrationId}`,
      given_name: givenName,
      family_name: familyName,
      clubs: club ? { id: `club-${registrationId}`, ...club } : null,
    },
  },
});

/** A bout as the admin and public match reads project it. */
export const viewBout = (id: string, label: string, over: SupabaseRow = {}): SupabaseRow => ({
  id,
  phase_id: 'p1',
  swiss_round_id: 'sr1',
  match_number_label: label,
  status: 'scheduled',
  scheduled_at: null,
  red_registration_id: 'r1',
  blue_registration_id: 'r2',
  red_score: null,
  blue_score: null,
  winner_registration_id: null,
  lices: { name: 'Piste 1', color_hex: '#ff0000' },
  ...over,
});

/** Four fighters of t1, plus another tournament's and one who withdrew. */
const ADMIN_REGISTRATIONS: SupabaseRow[] = [
  registration('r1'),
  registration('r2'),
  registration('r3'),
  registration('r4'),
  registration('rOther', { tournament_id: 't2' }),
  registration('rGone', { status: 'withdrawn' }),
];

/** p1, plus the same tournament's pool phase and another tournament's Swiss. */
const ADMIN_PHASES: SupabaseRow[] = [
  phaseRow(),
  { id: 'p-pool', type: 'pool', tournament_id: 't1', config_json: null },
  OTHER_PHASE,
];

/** The four entrants of p1 with their names, plus another phase's. */
const ADMIN_ENTRANTS: SupabaseRow[] = [
  namedEntrant('r1', 'Ada', 'Lovelace', { name: 'Club A', abbreviation: 'CLA' }),
  namedEntrant('r2', 'Grace', 'Hopper', { name: 'Club B', abbreviation: null }),
  namedEntrant('r3', 'Alan', 'Turing', null),
  namedEntrant('r4', 'Edsger', 'Dijkstra', null),
  { ...entrant('rX', 'p2'), registrations: null },
];

/** One completed round of p1, plus another phase's round. */
const ADMIN_ROUNDS: SupabaseRow[] = [
  swissRound({
    id: 'sr1',
    status: 'completed',
    matches: [
      { id: 'm1', red_registration_id: 'r1', blue_registration_id: 'r2', status: 'completed' },
      { id: 'm2', red_registration_id: 'r3', blue_registration_id: 'r4', status: 'completed' },
    ],
  }),
  swissRound({ id: 'sr-p2', phase_id: 'p2' }),
];

/** That round's two bouts, plus another phase's. */
const ADMIN_MATCHES: SupabaseRow[] = [
  viewBout('m1', 'SW-R1-M1'),
  viewBout('m2', 'SW-R1-M2', { red_registration_id: 'r3', blue_registration_id: 'r4' }),
  viewBout('m-p2', 'SW-R1-M1', { phase_id: 'p2', swiss_round_id: 'sr-p2' }),
];

/**
 * Every table the two Swiss view surfaces read, each carrying one decoy.
 *
 * Shared by the organiser's route and the public one: they read the same
 * tables, scoped the same way, and differ only in what they project. The
 * decoys are the point — every read here is scoped, and a fixture holding only
 * rows that belong cannot tell a scoped read from an unscoped one.
 */
export const swissViewState = (over: Record<string, unknown> = {}) => ({
  registrations: { rows: ADMIN_REGISTRATIONS },
  phases: { rows: ADMIN_PHASES },
  swiss_entrants: { rows: ADMIN_ENTRANTS },
  swiss_rounds: { rows: ADMIN_ROUNDS },
  matches: { rows: ADMIN_MATCHES },
  tournaments: {
    rows: [
      { id: 't1', weapon: 'longsword', scoring_config_json: null },
      { id: 't2', weapon: 'rapier', scoring_config_json: null },
    ],
  },
  ...over,
});

/**
 * Each write to `table`, paired with the row it was scoped to.
 *
 * An update names its row only through its filters, so `writesTo` alone cannot
 * tell "moved r3 into m2" from "moved r3 into every bout in the event".
 */
export const wroteTo = (supabase: { writes: RecordedWrite[] }, table: string) =>
  writesTo(supabase, table).map((write) => ({
    id: write.filters.find((f) => f.method === 'eq' && f.args[0] === 'id')?.args[1],
    row: write.row as SupabaseRow,
  }));
