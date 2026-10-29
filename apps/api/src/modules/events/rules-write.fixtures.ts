/**
 * The harness of the tests over a Tournament's rules as the doors write and read them: the PATCH
 * (a move of the pair, a save of its settings), the audited re-pin and its preview, and
 * `GET /tournaments/:id` with its `effectiveRules` (`ruleset-version-move.test.ts`,
 * `settings-save.test.ts`, `effective-rules.test.ts`).
 *
 * Seeded tables (`mockSupabase`), the REAL RulesetHashService and RulesetResolver over them; the
 * re-pin's database function applies what it is sent.
 */
import { vi } from 'vitest';
import { TFv1DefaultConfig } from '@myclash/rulesets';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';
import { RulesetHashService } from '../ruleset-hash/ruleset-hash.service';
import { RulesetResolver } from '../matches/ruleset-resolver.service';
import {
  mockSupabase,
  writesTo,
  type RpcAnswer,
  type TableSeed,
} from '../../common/testing/supabase-chain';

export type Row = Record<string, unknown>;
export const RPC = 'repin_tournament_rules';
export const assertOrgRole = vi.fn();

/** The organiser's own settings: a cap of 7 (the default is 10) and a win bonus of 5 (3). */
export const OWN = {
  ...TFv1DefaultConfig,
  winBonus: 5,
  matchFormat: { ...TFv1DefaultConfig.matchFormat, pointCap: 7 },
};

/** The federal pad, in the organiser's own colours and quick penalties. */
export const OWN_SCORING = {
  afterblowMode: 'deductive',
  buttons: {
    clean: [
      { label: '+2', value: 2, visible: true },
      { label: '+1', value: 1, visible: true },
    ],
    afterblow: [{ label: '2-1', attackerPts: 2, defenderPts: 1, visible: true }],
  },
  display: { sideColors: { red: 'blue', blue: 'red' }, quickPenalties: [1] },
};

/**
 * A draft: nothing started, so its rules are open to a plain save (the lock's own tests start it:
 * `settings-lock.test.ts`). The time it was last written is what a rules save is conditional on.
 */
export const ON_TF_1_0_0: Row = {
  id: 't1',
  event_id: 'e1',
  name: 'Sabre',
  status: 'draft',
  updated_at: '2026-10-01T09:00:00.000Z',
  ruleset_code: 'TF_v1',
  ruleset_version: '1.0.0',
  ruleset_config: OWN,
  scoring_config_json: OWN_SCORING,
  lock_config_json: null,
  penalty_ruleset_id: null,
  penalty_ruleset_version: null,
};

/** A club FORMULA ruleset: version 1.0.0 scores head 3 / limb 1, its current 1.0.1 head 4 / limb 2. */
export const grammarOf = (head: number, limb: number) => ({
  targets: [
    { name: 'Head', value: head },
    { name: 'Limb', value: limb },
  ],
  has_afterblow: false,
  afterblow_mode: null,
  afterblow_valuation: null,
  afterblow_fixed_value: null,
});
/** A formula the resolver accepts, so the club ruleset resolves for scoring as a real one does. */
const FORMULA = {
  score_formula: { type: 'var', name: 'victories' },
  constants: {},
  tiebreakers: [],
};
/**
 * The match format each of the club ruleset's versions seeds, unlike the engine's (90 s, soft
 * clock 5, cap 10) and unlike each other: a read of the wrong one shows in the cap.
 */
export const clubFormatOf = (pointCap: number) => ({
  pointCap,
  timeLimitsSeconds: { pool: 120, bracket: 120, finals: 120 },
  softClockLimitSeconds: 30,
});
export const CLUB = {
  rulesets: [
    {
      id: 'cr-club',
      code: 'custom_club',
      is_system: false,
      base_code: null,
      base_version: null,
      tf_config: null,
      // The parent row holds the draft after 1.0.1: a cap of 13.
      match_format_defaults: clubFormatOf(13),
      double_penalty_formula: null,
      ...FORMULA,
      ...grammarOf(4, 2),
    },
  ],
  versions: [
    {
      custom_ruleset_id: 'cr-club',
      version: '1.0.0',
      match_format_defaults: clubFormatOf(11),
      double_penalty_formula: null,
      ...FORMULA,
      ...grammarOf(3, 1),
    },
    {
      custom_ruleset_id: 'cr-club',
      version: '1.0.1',
      match_format_defaults: clubFormatOf(12),
      double_penalty_formula: null,
      ...FORMULA,
      ...grammarOf(4, 2),
    },
  ],
};
export const ON_CLUB_1_0_0: Row = {
  ...ON_TF_1_0_0,
  ruleset_code: 'custom_club',
  ruleset_version: '1.0.0',
};

/** A coded fork of TF_v1 whose tf_config targets (+4/+2) are not its targets column (+2/+1). */
export const FORK = {
  rulesets: [
    {
      id: 'cr-fork',
      code: 'custom_fork',
      is_system: false,
      base_code: 'TF_v1',
      base_version: '1.0.0',
      tf_config: {
        targets: [
          { name: 'Deep', value: 4 },
          { name: 'Shallow', value: 2 },
        ],
      },
      match_format_defaults: null,
      double_penalty_formula: null,
      ...grammarOf(2, 1),
    },
  ],
};

/**
 * The seeded tables around `row`; the re-pin's function writes what it is sent over `row`. Other
 * database functions answer by `functions`.
 */
function seededDb(
  row: Row,
  custom: { rulesets?: Row[]; versions?: Row[] },
  tables: Record<string, TableSeed>,
  functions: Record<string, RpcAnswer> = {},
) {
  return mockSupabase(
    {
      tournaments: { rows: [row] },
      events: { rows: [{ id: 'e1', organization_id: 'org-1', status: 'published' }] },
      platform_roles: { rows: [] },
      phases: { rows: [] },
      matches: { rows: [] },
      custom_rulesets: { rows: custom.rulesets ?? [] },
      custom_ruleset_versions: { rows: custom.versions ?? [] },
      penalty_rulesets: { rows: [] },
      tournament_ruleset_repins: { rows: [] },
      audit_log: { rows: [] },
      ...tables,
    },
    {
      [RPC]: (args) => {
        Object.assign(row, JSON.parse(JSON.stringify(args['p_next'])));
        return { data: 'repin-1', error: null };
      },
      ...functions,
    },
  );
}

/** What the screen read: the raw rules columns of `row` (`RulesExpected`). */
export const expectedOf = (row: Row) => ({
  rulesetCode: row['ruleset_code'],
  rulesetVersion: row['ruleset_version'],
  rulesetConfig: row['ruleset_config'],
  scoringConfig: row['scoring_config_json'],
  penaltyRulesetId: row['penalty_ruleset_id'],
  penaltyRulesetVersion: row['penalty_ruleset_version'],
  forfeitRules: row['forfeit_rules'] ?? null,
});

/** A refusal's status and body as the filter sends it: the extra keys move into `details`. */
export async function refusal(promise: Promise<unknown>) {
  const err = (await promise.then(
    () => null,
    (e: unknown) => e,
  )) as { getStatus(): number; getResponse(): Row } | null;
  if (!err) throw new Error('the save was not refused');
  return { status: err.getStatus(), body: err.getResponse() };
}

/** What a test may hand the service beyond the seeded tables. */
export interface HarnessOptions {
  /** The club-role check the service asks: the mock unless a test builds the real one. */
  orgs?: (db: ReturnType<typeof seededDb>) => unknown;
  /** Database functions beside the re-pin's, by name. */
  functions?: Record<string, RpcAnswer>;
  /** The status settle and the label reader of an audited forfeit rules change (5b). */
  fighterStatus?: unknown;
  labels?: unknown;
}

export function harness(
  current: Row = ON_TF_1_0_0,
  custom: { rulesets?: Row[]; versions?: Row[] } = {},
  tables: Record<string, TableSeed> = {},
  options: HarnessOptions = {},
) {
  const row = structuredClone(current);
  const db = seededDb(row, custom, tables, options.functions);
  const registry = createRulesetRegistry();
  const rulesHash = new RulesetHashService(db as never, registry);
  const svc = new EventsService(
    db as never,
    (options.orgs?.(db) ?? { assertOrgRole }) as never,
    {} as never,
    registry,
    undefined,
    undefined,
    undefined,
    { getPoolStandings: vi.fn().mockResolvedValue({ rows: [] }) } as never,
    {
      offeredVersion: vi.fn().mockResolvedValue('1.0.1'),
      draftsOfferedTo: vi.fn().mockResolvedValue(false),
    } as never,
    rulesHash,
    options.fighterStatus as never,
    options.labels as never,
  );
  /** The rules the move wrote: the PATCH's own update, or what the re-pin sent the database. */
  const written = (): Row | undefined =>
    (writesTo(db, 'tournaments')
      .map((write) => write.row as Row)
      .find((patch) => 'ruleset_config' in patch || 'scoring_config_json' in patch) ??
      db.rpc.mock.calls.find(([name]) => name === RPC)?.[1]?.['p_next']) as Row | undefined;
  const settings = () =>
    written()?.['ruleset_config'] as Record<string, Record<string, unknown>> | undefined;
  const scoring = () => written()?.['scoring_config_json'] as typeof OWN_SCORING | undefined;
  /** `GET /tournaments/:id` as a signed-in organiser asks it. */
  const getTournament = (userId = 'u1') =>
    new EventsController(
      svc,
      { getAuthUser: vi.fn().mockResolvedValue({ id: userId }) } as never,
      {} as never,
      {} as never,
      {} as never,
      new RulesetResolver(db as never, registry),
    ).getTournament('t1', { headers: { authorization: 'Bearer token' }, cookies: {} } as never);
  return { svc, db, row, rulesHash, settings, scoring, written, getTournament };
}
