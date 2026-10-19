/**
 * Which end decision a club formula ruleset is written with (migration 0228,
 * rulings "Club formulas" and "Edition day", 2026-10-17): today's at create, the
 * day's again when a version is published, unless a Tournament already scores
 * with that version; none on a coded fork. The resolver reads it back
 * (ruleset-resolver.edition.test.ts); export and import carry it
 * (custom-rulesets.export.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomRulesetsService, TODAYS_EDITION } from './custom-rulesets.service';
import { supabaseRpc } from '../../../common/testing/supabase-chain';
import { createRulesetRegistry } from '../../rulesets/ruleset-registry';

const CONSTANTS = { pointsPerVictory: 3, pointsPerTie: 1, pointsPerLoss: 0, doublePenalty: 0 };
const TIEBREAKERS = [{ variable: 'victories' as const, direction: 'desc' as const }];
const TARGETS = [{ name: 'Hit', value: 1 }];

const formulaRow = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  code: 'custom_x',
  version: '1.0.0',
  name: 'X',
  description: null,
  status: 'draft',
  is_system: false,
  base_code: null,
  base_version: null,
  score_formula: { type: 'var', name: 'victories' },
  constants: CONSTANTS,
  tiebreakers: TIEBREAKERS,
  match_format_defaults: null,
  double_penalty_formula: null,
  targets: TARGETS,
  has_afterblow: false,
  afterblow_mode: null,
  afterblow_valuation: null,
  afterblow_fixed_value: null,
  decision_edition: '2026-04',
  ...over,
});

/** The `.eq()` filters of one query, in order: the double answers whatever is filtered. */
type Filters = Array<[string, unknown]>;

interface Written {
  inserts: Array<{ table: string; row: Record<string, unknown> }>;
  updates: Array<{ table: string; row: Record<string, unknown>; filters: Filters }>;
  /** The filters of each Tournament count: the version the freeze is asked about. */
  counts: Filters[];
  /** The payload of each ask whether a bout holds a copy naming the version. */
  held: Array<Record<string, unknown>>;
}

/**
 * Every table answers `row`; a Tournament count answers `pinned`; the ask whether a bout holds a
 * copy naming the version answers `held`. Writes are kept.
 */
function serviceOver(row: Record<string, unknown>, pinned = 0, held = false) {
  const written: Written = { inserts: [], updates: [], counts: [], held: [] };
  const rpc = supabaseRpc({
    ruleset_pair_held_by_a_bout: (args) => {
      written.held.push(args);
      return { data: held, error: null };
    },
  });
  const from = vi.fn().mockImplementation((table: string) => {
    const answer =
      table === 'tournaments' ? { count: pinned, error: null } : { data: row, error: null };
    const filters: Filters = [];
    if (table === 'tournaments') written.counts.push(filters);
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation((column: string, value: unknown) => {
        filters.push([column, value]);
        return chain;
      }),
      maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
      single: vi.fn().mockResolvedValue({ data: row, error: null }),
      insert: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
        written.inserts.push({ table, row: payload });
        return chain;
      }),
      update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
        written.updates.push({ table, row: payload, filters });
        return chain;
      }),
      then: (resolve: (value: unknown) => unknown) => resolve(answer),
    };
    return chain;
  });
  const service = new CustomRulesetsService(
    { service: { from, rpc } } as never,
    createRulesetRegistry(),
  );
  return { service, written };
}

const DTO = {
  name: 'House rules',
  scoreFormula: { type: 'var', name: 'victories' },
  constants: CONSTANTS,
  tiebreakers: TIEBREAKERS,
  targets: TARGETS,
} as never;

const inserted = (written: Written, table: string) =>
  written.inserts.find((write) => write.table === table)?.row;
const editionUpdates = (written: Written) =>
  written.updates.filter(
    (write) => write.table === 'custom_rulesets' && 'decision_edition' in write.row,
  );

describe('the end decision a club formula ruleset is written with', () => {
  beforeEach(() => vi.clearAllMocks());

  it("is today's: the newest edition", () => {
    expect(TODAYS_EDITION).toBe('2026-10');
  });

  it("a new draft, a club's new ruleset and a copy take today's", async () => {
    const draft = serviceOver(formulaRow());
    await draft.service.create(DTO, 'actor-1');
    expect(inserted(draft.written, 'custom_rulesets')?.decision_edition).toBe('2026-10');

    const club = serviceOver(formulaRow());
    await club.service.createForOrg('org-1', DTO, 'actor-1');
    expect(inserted(club.written, 'custom_rulesets')?.decision_edition).toBe('2026-10');

    // The source holds 2026-04: a copy is a new ruleset, published on its own day.
    const copy = serviceOver(formulaRow());
    await copy.service.clone('r1', 'actor-1');
    expect(inserted(copy.written, 'custom_rulesets')?.decision_edition).toBe('2026-10');
  });

  it('an import keeps the one its file names', async () => {
    const { service, written } = serviceOver(formulaRow());
    await service.createForOrg('org-1', DTO, 'actor-1', '2026-04');
    expect(inserted(written, 'custom_rulesets')?.decision_edition).toBe('2026-04');
  });

  it("publishing a version no Tournament uses gives it the day's, row and snapshot", async () => {
    const { service, written } = serviceOver(formulaRow(), 0);
    await service.publish('r1', 'actor-1');
    expect(editionUpdates(written).map((write) => write.row.decision_edition)).toEqual(['2026-10']);
    // This row only, and asked about the version published, not the one it bumps to.
    expect(editionUpdates(written)[0]?.filters).toEqual([['id', 'r1']]);
    expect(written.counts).toContainEqual([
      ['ruleset_code', 'custom_x'],
      ['ruleset_version', '1.0.0'],
    ]);
    expect(written.held).toEqual([{ p_code: 'custom_x', p_version: '1.0.0' }]);
    expect(inserted(written, 'custom_ruleset_versions')?.decision_edition).toBe('2026-10');
  });

  it('publishing a version a Tournament already scores with keeps the one it is scored under', async () => {
    const { service, written } = serviceOver(formulaRow(), 1);
    await service.publish('r1', 'actor-1');
    expect(editionUpdates(written)).toEqual([]);
    expect(inserted(written, 'custom_ruleset_versions')?.decision_edition).toBe('2026-04');
  });

  it('so does one only a copy held by a bout still names, its Tournament moved to another ruleset', async () => {
    const { service, written } = serviceOver(formulaRow(), 0, true);
    await service.publish('r1', 'actor-1');
    expect(editionUpdates(written)).toEqual([]);
    expect(inserted(written, 'custom_ruleset_versions')?.decision_edition).toBe('2026-04');
  });

  it('a coded fork holds none: its base engine names it', async () => {
    const fork = formulaRow({
      base_code: 'TF_v1',
      base_version: '1.1.0',
      score_formula: {},
      constants: {},
      tiebreakers: [],
      decision_edition: null,
    });
    const { service, written } = serviceOver(fork, 0);
    await service.publish('r1', 'actor-1');
    expect(editionUpdates(written)).toEqual([]);
    expect(inserted(written, 'custom_ruleset_versions')?.decision_edition).toBeNull();
  });
});
