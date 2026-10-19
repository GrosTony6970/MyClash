/**
 * The public notice of a Tournament's rules changes (`loadRulesetRepins`), read through the public
 * Tournament page's standings answer: every change newest first, each pair named once, and no
 * value a club wrote as its formula (operator ruling "Private formula": an ALLOW-list).
 *
 * The real EventsService and the real built-in registry over seeded tables, through the controller.
 */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { RulesChangeNotice } from '@myclash/types';
import { mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { publicChange } from './rules-change-notice';

type Row = Record<string, unknown>;
const EVENT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const record = (over: Row): Row => ({
  tournament_id: 't1',
  kind: 'ruleset',
  from_code: 'TF_v1',
  from_version: '1',
  to_code: 'TF_v1',
  to_version: '1.1.0',
  justification: 'The end rule of the 2026-10 edition applies from today.',
  changes: [],
  created_at: '2026-10-19T10:00:00Z',
  // Never on the public page.
  actor_user_id: 'u-owner',
  placings_before: [{ displayName: 'Alice' }],
  config_before: { secret: 'config' },
  ...over,
});

/** A change of a club formula's own definition, values a club keeps for itself. */
const FORMULA_CHANGES = [
  { path: 'scoreFormula', before: { op: 'secret-a' }, after: { op: 'secret-b' }, locked: true },
  { path: 'constants', before: { k: 11 }, after: { k: 12 }, locked: true },
  { path: 'tiebreakers', before: ['secret-t1'], after: ['secret-t2'], locked: true },
  { path: 'doublePenaltyFormula', before: 'secret-p1', after: 'secret-p2', locked: true },
];

/** The published Tournament the page reads, on TF_v1 1.1.0, and the club rulesets' names. */
const SEED = {
  events: { rows: [{ id: EVENT, slug: 'open', status: 'published', organization_id: 'org-a' }] },
  tournaments: {
    rows: [
      {
        ...{ id: 't1', event_id: EVENT, slug: 'sabre', name: 'Sabre', status: 'published' },
        ...{ weapon: 'sabre', ruleset_code: 'TF_v1', ruleset_version: '1.1.0' },
        ...{ logo_url: null, color: null, scoring_config_json: null },
      },
    ],
  },
  custom_rulesets: { rows: [{ code: 'custom_house', name: 'House formula' }] },
  phases: { rows: [] },
  registrations: { rows: [] },
};

const ANONYMOUS = {
  headers: {},
  cookies: {},
  identity: { kind: 'anonymous' },
  staffSession: null,
} as never;

function build(records: Row[], repins: Row = { rows: records }) {
  const db = mockSupabase({ ...SEED, tournament_ruleset_repins: repins });
  const orgs = new OrganizationsService(db as never);
  const events = new EventsService(db as never, orgs, {} as never, createRulesetRegistry());
  const controller = new EventsController(
    events,
    db as never,
    {} as never,
    {} as never,
    orgs,
    {} as never,
  );
  const notices = async () => {
    const page = await controller.getPublicTournamentStandings('open', 'sabre', ANONYMOUS);
    return page.tournament['rulesetRepins'] as RulesChangeNotice[];
  };
  return { db, notices, events };
}

describe('the public notice of rules changes', () => {
  it('lists every change, newest first, by name and version, with nothing private', async () => {
    const { notices, db } = build([
      record({ created_at: '2026-10-18T09:00:00Z', to_code: 'custom_house', to_version: '1' }),
      record({ created_at: '2026-10-19T10:00:00Z', kind: 'settings', from_version: '1.1.0' }),
    ]);
    const list = await notices();
    expect(list.map((n) => [n.kind, n.fromLabel, n.fromVersion, n.toLabel, n.toVersion])).toEqual([
      ['settings', 'TF_v1', '1.1.0', 'TF_v1', '1.1.0'],
      ['ruleset', 'TF_v1', '1.0.0', 'House formula', '1.0.0'],
    ]);
    expect(list[1]).toMatchObject({ privateFormula: true, changedAt: '2026-10-18T09:00:00Z' });
    expect(list[0]?.privateFormula).toBe(false);
    // One ruleset or two is told by the codes: two rulesets may share a label.
    expect(list.map((n) => n.sameRuleset)).toEqual([true, false]);
    expect(selectsFor(db.from, 'tournament_ruleset_repins')).toEqual([
      'kind, from_code, from_version, to_code, to_version, justification, changes, created_at',
    ]);
    expect(JSON.stringify(list)).not.toMatch(/u-owner|Alice|secret/);
  });

  it('names each distinct club pair once', async () => {
    const move = { from_code: 'custom_house', to_code: 'custom_house', from_version: '1.0.0' };
    const { notices, db } = build([record(move), record(move), record(move)]);
    await notices();
    // Two pairs (1.0.0 and 1.1.0) over three records: two reads, not six.
    const labelReads = selectsFor(db.from, 'custom_rulesets').filter((s) => s === 'name');
    expect(labelReads).toHaveLength(2);
  });

  it("leaves no value of a club formula's definition between two of its versions", async () => {
    const { notices } = build([
      record({
        from_code: 'custom_house',
        to_code: 'custom_house',
        from_version: '1.0.0',
        to_version: '1.0.1',
        changes: [
          ...FORMULA_CHANGES,
          { path: 'matchFormat.pointCap', before: 5, after: 7, locked: true },
        ],
      }),
    ]);
    const [notice] = await notices();
    expect(JSON.stringify(notice)).not.toContain('secret');
    expect(JSON.stringify(notice)).not.toMatch(/\b1[12]\b/);
    expect(notice?.changes).toContainEqual({
      path: 'matchFormat.pointCap',
      before: 5,
      after: 7,
      locked: true,
    });
  });

  it("hides a formula's values on a move from a built-in to a club formula", async () => {
    const { notices } = build([record({ to_code: 'custom_house', changes: FORMULA_CHANGES })]);
    expect(JSON.stringify(await notices())).not.toContain('secret');
  });

  it("hides a formula's values on a move from a club formula to a built-in", async () => {
    const { notices } = build([record({ from_code: 'custom_house', changes: FORMULA_CHANGES })]);
    const [notice] = await notices();
    expect(notice?.privateFormula).toBe(true);
    expect(JSON.stringify(notice)).not.toContain('secret');
  });

  it("keeps a built-in's own double-hit penalty values: they are no club's", async () => {
    const change = { path: 'doublePenaltyFormula', before: 'n*(n-1)/3', after: 'n', locked: true };
    const { notices } = build([record({ kind: 'settings', changes: [change] })]);
    expect((await notices())[0]?.changes).toEqual([change]);
  });

  it('logs a failed read and shows the page without the notice', async () => {
    const { notices, events } = build([], { data: null, error: { message: 'connection reset' } });
    const { logger } = events as unknown as { logger: { warn: (message: string) => void } };
    const logged = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    expect(await notices()).toEqual([]);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('connection reset'));
  });
});

describe('publicChange', () => {
  it('crosses an unknown path, or a path this build does not list, as a path alone', () => {
    const unknown = { path: 'unknown' as const, before: { x: 'secret' }, after: { x: 'b' } };
    expect(publicChange(unknown, false)).toEqual({ path: 'unknown', before: null, after: null });
    const newer = { path: 'grammar.newThing', before: 1, after: 2 } as never;
    expect(publicChange(newer, false)).toEqual({ path: 'unknown', before: null, after: null });
  });
});
