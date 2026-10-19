/**
 * The harness of the audited re-pin's tests (`repin.test.ts`, `repin.refusals.test.ts`): seeded
 * tables (`mockSupabase`) and the REAL RulesetHashService over them, so the hash written is the one
 * the fingerprint computes. The RPC double APPLIES `p_next` to the seeded row, through JSON as
 * `jsonb` stores it, and answers a record id.
 */
import { vi } from 'vitest';
import { EventsService } from './events.service';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';
import { RulesetHashService } from '../ruleset-hash/ruleset-hash.service';
import { mockSupabase, type RpcAnswer } from '../../common/testing/supabase-chain';

export const RPC = 'repin_tournament_rules';
export const assertOrgRole = vi.fn();
export type Row = Record<string, unknown>;

export const RUNNING_TF: Row = {
  id: 't1',
  event_id: 'e1',
  name: 'Épée  Dames',
  status: 'running',
  ruleset_code: 'TF_v1',
  ruleset_version: '1.0.0',
  ruleset_config: { winBonus: 3 },
  scoring_config_json: null,
  penalty_ruleset_id: null,
  penalty_ruleset_version: null,
  ruleset_content_hash: 'stale',
};

/** The raw rules of RUNNING_TF, as its screen read them. */
export const EXPECTED = {
  rulesetCode: 'TF_v1',
  rulesetVersion: '1.0.0',
  rulesetConfig: { winBonus: 3 },
  scoringConfig: null,
  penaltyRulesetId: null,
  penaltyRulesetVersion: null,
};

export const REASON = 'Wrong ruleset selected during setup; correcting to points cap.';
export const dto = (over: Row = {}) =>
  ({
    rulesetCode: 'Generic_PointsCap',
    justification: REASON,
    confirm: 'épée dames',
    expected: EXPECTED,
    ...over,
  }) as never;

/**
 * The database function: writes `p_next` over the table's row, as it would, and answers the record.
 * A NEW row object: the one the door read stays as it read it, so an answer that is not the row
 * read back after the write cannot pass for one.
 */
const applying =
  (rows: Row[]): RpcAnswer =>
  (args) => {
    rows[0] = { ...rows[0], ...JSON.parse(JSON.stringify(args['p_next'])) };
    return { data: 'repin-1', error: null };
  };

export function harness(opts: { row?: Row; isSuperAdmin?: boolean; offered?: string | null } = {}) {
  const row = { ...RUNNING_TF, ...opts.row };
  const tournamentRows = [row];
  const rpcAnswer = vi.fn(applying(tournamentRows));
  const db = mockSupabase(
    {
      tournaments: { rows: tournamentRows },
      events: { rows: [{ id: 'e1', organization_id: 'org-1' }] },
      platform_roles: { rows: opts.isSuperAdmin ? [{ user_id: 'u1', role: 'super_admin' }] : [] },
      custom_rulesets: { rows: [] },
      custom_ruleset_versions: { rows: [] },
      penalty_rulesets: { rows: [] },
      tournament_ruleset_repins: { rows: [] },
      audit_log: { rows: [] },
    },
    { [RPC]: (args) => rpcAnswer(args) },
  );
  const registry = createRulesetRegistry();
  const rulesHash = new RulesetHashService(db as never, registry);
  const standings = [{ rank: 1, registrationId: 'r1', displayName: 'Alice', stats: { score: 5 } }];
  const poolStandings = { getPoolStandings: vi.fn().mockResolvedValue({ rows: standings }) };
  const selectableRulesets = {
    offeredVersion: vi.fn().mockResolvedValue(opts.offered === undefined ? '1.0.0' : opts.offered),
    draftsOfferedTo: vi.fn().mockResolvedValue(opts.isSuperAdmin ?? false),
  };
  const svc = new EventsService(
    db as never,
    { assertOrgRole } as never,
    {} as never,
    registry,
    undefined,
    undefined,
    undefined,
    poolStandings as never,
    selectableRulesets as never,
    rulesHash,
  );
  const calls = () => db.rpc.mock.calls.filter(([name]) => name === RPC).map(([, args]) => args!);
  return { svc, db, row, rpcAnswer, calls, rulesHash, selectableRulesets };
}
