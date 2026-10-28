/**
 * The lock of a Tournament's settings save and its audited form (the audited settings change,
 * revisions 7-18 of its plan; rulings 148, "Offline clock", "Phase lock").
 *
 * Over the REAL `updateTournament`, the real fingerprint and seeded tables (`rules-write.fixtures`):
 * the clock is read from the rows, so "started" is a bout that left `scheduled`, never a flag.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as MatchRuleset from '../phases/match-ruleset';
import { filtersFor, writesTo } from '../../common/testing/supabase-chain';
import { assertOrgRole, harness, ON_TF_1_0_0, RPC, type Row } from './rules-write.fixtures';

vi.mock('../phases/match-ruleset', async (original) => ({
  ...(await original<typeof MatchRuleset>()),
  restampUnstartedMatches: vi.fn(() => Promise.resolve()),
}));

beforeEach(() => {
  vi.clearAllMocks();
  assertOrgRole.mockResolvedValue(undefined);
});

const RUNNING: Row = { ...ON_TF_1_0_0, status: 'running' };
const POOL = { id: 'p1', type: 'pool', tournament_id: 't1' };
/** A draft whose first Pool bout is fought: its Tournament keys lock, its finals keys do not. */
const POOL_STARTED = {
  phases: { rows: [POOL] },
  matches: {
    rows: [{ id: 'm1', phase_id: 'p1', status: 'completed', match_number_label: null }],
  },
};
const eventOf = (status: string) => ({
  events: { rows: [{ id: 'e1', organization_id: 'org-1', status }] },
});

const CAP_9 = { rulesetConfig: { matchFormat: { pointCap: 9 } } };
const FINALS_200 = { rulesetConfig: { matchFormat: { timeLimitsSeconds: { finals: 200 } } } };

/** What the screen read: the raw rules columns of `row`. */
const expectedOf = (row: Row) => ({
  rulesetCode: row['ruleset_code'],
  rulesetVersion: row['ruleset_version'],
  rulesetConfig: row['ruleset_config'],
  scoringConfig: row['scoring_config_json'],
  penaltyRulesetId: row['penalty_ruleset_id'],
  penaltyRulesetVersion: row['penalty_ruleset_version'],
});
const audit = (row: Row, over: Row = {}) => ({
  justification: 'The referees asked for a lower cap.',
  confirm: String(row['name']),
  expected: expectedOf(row),
  ...over,
});

/** The refusal's body as the filter sends it: the extra keys move into `details`. */
async function refusal(promise: Promise<unknown>) {
  const err = (await promise.then(
    () => null,
    (e: unknown) => e,
  )) as { getStatus(): number; getResponse(): Row } | null;
  if (!err) throw new Error('the save was not refused');
  return { status: err.getStatus(), body: err.getResponse() };
}

const rulesWrites = (h: ReturnType<typeof harness>) =>
  writesTo(h.db, 'tournaments').filter((w) => 'ruleset_config' in (w.row as Row));

describe('the lock of a plain save', () => {
  it('refuses a cap change once the Tournament runs, listing it locked; nothing written', async () => {
    const h = harness(RUNNING);
    const { status, body } = await refusal(h.svc.updateTournament('t1', CAP_9 as never, 'u1'));
    expect(status).toBe(403);
    expect(body['code']).toBe('rules_change_needs_audit');
    expect(body['changes']).toEqual([
      { path: 'matchFormat.pointCap', before: 7, after: 9, locked: true },
    ]);
    expect(rulesWrites(h)).toEqual([]);
  });

  it('saves a finals time while only Pool bouts started: a finals key waits for a finals bout', async () => {
    const h = harness(ON_TF_1_0_0, {}, POOL_STARTED);
    await h.svc.updateTournament('t1', FINALS_200 as never, 'u1');
    expect(h.settings()?.['matchFormat']?.['timeLimitsSeconds']).toMatchObject({ finals: 200 });
  });

  it('lists every change of a refused save, the cap locked and the finals time free', async () => {
    const h = harness(ON_TF_1_0_0, {}, POOL_STARTED);
    const both = {
      rulesetConfig: { matchFormat: { pointCap: 9, timeLimitsSeconds: { finals: 200 } } },
    };
    const { body } = await refusal(h.svc.updateTournament('t1', both as never, 'u1'));
    const flags = (body['changes'] as Row[]).map((c) => [c['path'], c['locked']]);
    expect(flags).toEqual([
      ['matchFormat.pointCap', true],
      ['matchFormat.timeLimitsSeconds.finals', false],
    ]);
  });

  it('runs when the Event runs with bouts made, none started: the cap locks', async () => {
    const madeOnly = {
      ...eventOf('running'),
      phases: { rows: [POOL] },
      matches: {
        rows: [{ id: 'm1', phase_id: 'p1', status: 'scheduled', match_number_label: null }],
      },
    };
    const { body } = await refusal(
      harness(ON_TF_1_0_0, {}, madeOnly).svc.updateTournament('t1', CAP_9 as never, 'u1'),
    );
    expect(body['code']).toBe('rules_change_needs_audit');
  });

  it('saves the cap of a Tournament whose Event runs but which has no bout made yet', async () => {
    const h = harness(ON_TF_1_0_0, {}, eventOf('running'));
    await h.svc.updateTournament('t1', CAP_9 as never, 'u1');
    expect(h.settings()?.['matchFormat']?.['pointCap']).toBe(9);
  });

  it('saves a button label on a running Tournament: no value changed, nothing locks', async () => {
    const h = harness(RUNNING);
    const scoring = h.row['scoring_config_json'] as { buttons: { clean: Row[] } };
    const relabelled = scoring.buttons.clean.map((b, i) => (i === 0 ? { ...b, label: 'Two' } : b));
    await h.svc.updateTournament(
      't1',
      { scoringConfig: { buttons: { ...scoring.buttons, clean: relabelled } } } as never,
      'u1',
    );
    expect(h.scoring()?.buttons.clean[0]).toMatchObject({ label: 'Two', value: 2 });
  });

  it('refuses a button VALUE change on a running Tournament', async () => {
    const h = harness(RUNNING);
    const scoring = h.row['scoring_config_json'] as { buttons: { clean: Row[] } };
    const revalued = scoring.buttons.clean.map((b, i) => (i === 0 ? { ...b, value: 3 } : b));
    const { body } = await refusal(
      h.svc.updateTournament(
        't1',
        { scoringConfig: { buttons: { ...scoring.buttons, clean: revalued } } } as never,
        'u1',
      ),
    );
    expect((body['changes'] as Row[]).map((c) => c['path'])).toEqual(['buttons.clean']);
  });

  it('refuses the clock it cannot read: 503, nothing written (fail closed)', async () => {
    const h = harness(RUNNING, {}, { phases: { data: null, error: { message: 'phases down' } } });
    const { status, body } = await refusal(h.svc.updateTournament('t1', CAP_9 as never, 'u1'));
    expect([status, body['code']]).toEqual([503, 'rules_check_unavailable']);
    expect(rulesWrites(h)).toEqual([]);
  });

  it('refuses a move of the pair on a running Tournament with the code that opens the re-pin', async () => {
    const { status, body } = await refusal(
      harness(RUNNING).svc.updateTournament('t1', { rulesetVersion: '1.1.0' } as never, 'u1'),
    );
    expect([status, body['code']]).toEqual([403, 'rules_change_needs_audit']);
  });
});

describe('an Event that is over closes the rules (ruling 148)', () => {
  it('refuses a locked change of a running Tournament under a completed Event: closed by it', async () => {
    const h = harness(RUNNING, {}, eventOf('completed'));
    const { status, body } = await refusal(h.svc.updateTournament('t1', CAP_9 as never, 'u1'));
    expect([status, body['code'], body['closedBy']]).toEqual([403, 'rules_change_closed', 'event']);
    expect(rulesWrites(h)).toEqual([]);
  });

  it('still saves a status change there: a plain save is never closed', async () => {
    const h = harness(RUNNING, {}, eventOf('completed'));
    await h.svc.updateTournament('t1', { status: 'published' } as never, 'u1');
    expect(writesTo(h.db, 'tournaments').map((w) => (w.row as Row)['status'])).toContain(
      'published',
    );
  });

  it('still saves an unlocked rules change there: nothing locks, nothing is closed', async () => {
    const h = harness(ON_TF_1_0_0, {}, eventOf('completed'));
    await h.svc.updateTournament('t1', CAP_9 as never, 'u1');
    expect(h.settings()?.['matchFormat']?.['pointCap']).toBe(9);
  });

  it('refuses an audited change of a completed Tournament: closed by itself', async () => {
    const done = { ...RUNNING, status: 'completed' };
    const h = harness(done);
    const { body } = await refusal(
      h.svc.updateTournament('t1', { ...CAP_9, audit: audit(done) } as never, 'u1'),
    );
    expect([body['code'], body['closedBy']]).toEqual(['rules_change_closed', 'tournament']);
    expect(h.db.rpc).not.toHaveBeenCalled();
  });
});

describe('the audited save checks closed first', () => {
  it('a completed Tournament with a stale read and a wrong name is refused as closed', async () => {
    const done = { ...RUNNING, status: 'completed' };
    const stale = audit(done, {
      confirm: 'Epee',
      expected: { ...expectedOf(done), rulesetVersion: '1.1.0' },
    });
    const { body } = await refusal(
      harness(done).svc.updateTournament('t1', { ...CAP_9, audit: stale } as never, 'u1'),
    );
    expect(body['code']).toBe('rules_change_closed');
  });

  it('a stale read with a wrong name is refused as stale before the name is asked', async () => {
    const stale = audit(RUNNING, {
      confirm: 'Epee',
      expected: { ...expectedOf(RUNNING), rulesetVersion: '1.1.0' },
    });
    const { body } = await refusal(
      harness(RUNNING).svc.updateTournament('t1', { ...CAP_9, audit: stale } as never, 'u1'),
    );
    expect(body['code']).toBe('rules_changed_since_read');
  });
});

describe('the audited save', () => {
  it('writes the change with its record in one call, the pair kept, every change listed', async () => {
    const h = harness(RUNNING);
    const answer = (await h.svc.updateTournament(
      't1',
      { ...CAP_9, audit: audit(RUNNING) } as never,
      'u1',
    )) as Row;
    expect(h.db.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = h.db.rpc.mock.calls[0] as [string, Row];
    expect(name).toBe(RPC);
    expect((args['p_audit'] as Row)['kind']).toBe('settings');
    expect((args['p_next'] as Row)['ruleset_code']).toBe('TF_v1');
    expect((args['p_next'] as Row)['ruleset_version']).toBe('1.0.0');
    expect(((args['p_next'] as Row)['ruleset_config'] as Row)['matchFormat']).toMatchObject({
      pointCap: 9,
    });
    expect(answer['rulesetChange']).toEqual({
      changes: [{ path: 'matchFormat.pointCap', before: 7, after: 9, locked: true }],
      readBackFailed: false,
    });
    expect((answer['tournament'] as Row)['id']).toBe('t1');
  });

  it('records an audited save even when nothing in it locks: the organiser asked', async () => {
    const h = harness(ON_TF_1_0_0);
    await h.svc.updateTournament('t1', { ...CAP_9, audit: audit(ON_TF_1_0_0) } as never, 'u1');
    expect(h.db.rpc).toHaveBeenCalledTimes(1);
  });

  it('refuses rules that moved since the screen read them: 409, nothing written', async () => {
    const h = harness(RUNNING);
    const stale = audit(RUNNING, { expected: { ...expectedOf(RUNNING), rulesetVersion: '1.1.0' } });
    const { status, body } = await refusal(
      h.svc.updateTournament('t1', { ...CAP_9, audit: stale } as never, 'u1'),
    );
    expect([status, body['code']]).toEqual([409, 'rules_changed_since_read']);
    expect(h.db.rpc).not.toHaveBeenCalled();
  });

  it('refuses a name typed wrong', async () => {
    const h = harness(RUNNING);
    const { status, body } = await refusal(
      h.svc.updateTournament(
        't1',
        { ...CAP_9, audit: audit(RUNNING, { confirm: 'Epee' }) } as never,
        'u1',
      ),
    );
    expect([status, body['code']]).toEqual([400, 'rules_confirm_mismatch']);
  });

  it('refuses a move of the pair: the re-pin moves it, nothing is written', async () => {
    const h = harness(RUNNING);
    const move = { rulesetVersion: '1.1.0', audit: audit(RUNNING) };
    const { body } = await refusal(h.svc.updateTournament('t1', move as never, 'u1'));
    expect(body['code']).toBe('rules_change_needs_audit');
    expect(h.db.rpc).not.toHaveBeenCalled();
  });

  it('refuses a save that carries more than rules', async () => {
    const h = harness(RUNNING);
    const mixed = { ...CAP_9, name: 'Sabre Open', audit: audit(RUNNING) };
    const { status, body } = await refusal(h.svc.updateTournament('t1', mixed as never, 'u1'));
    expect([status, body['code']]).toEqual([400, 'rules_change_mixed']);
    expect(h.db.rpc).not.toHaveBeenCalled();
  });

  it('refuses a save that changes no rule', async () => {
    const h = harness(RUNNING);
    const same = { rulesetConfig: { matchFormat: { pointCap: 7 } }, audit: audit(RUNNING) };
    const { status, body } = await refusal(h.svc.updateTournament('t1', same as never, 'u1'));
    expect([status, body['code']]).toEqual([400, 'rules_unchanged']);
  });

  it.each([
    ['matching', audit(RUNNING)],
    ['stale', audit(RUNNING, { expected: { ...expectedOf(RUNNING), rulesetCode: 'X' } })],
  ])('asks who the caller is first: a %s expected gets the same refusal', async (_, sent) => {
    assertOrgRole.mockRejectedValue(new Error('not an admin of this club'));
    const h = harness(RUNNING);
    await expect(
      h.svc.updateTournament('t1', { ...CAP_9, audit: sent } as never, 'u1'),
    ).rejects.toThrow('not an admin of this club');
  });

  it('answers 200 with no row when the row is not read back after the commit', async () => {
    const h = harness(RUNNING);
    const apply = h.db.rpc.getMockImplementation()!;
    h.db.rpc.mockImplementationOnce((name: string, args?: Row) => {
      const answer = apply(name, args);
      h.row['id'] = 'moved';
      return answer;
    });
    const answer = (await h.svc.updateTournament(
      't1',
      { ...CAP_9, audit: audit(RUNNING) } as never,
      'u1',
    )) as Row;
    expect(answer['tournament']).toBeNull();
    expect((answer['rulesetChange'] as Row)['readBackFailed']).toBe(true);
  });
});

describe('a rules save is written on the row it read', () => {
  it('a rules save is conditional on the time the row was last written', async () => {
    const h = harness(ON_TF_1_0_0);
    await h.svc.updateTournament('t1', CAP_9 as never, 'u1');
    expect(filtersFor(h.db.from, 'tournaments', 'eq')).toContainEqual([
      'updated_at',
      ON_TF_1_0_0['updated_at'],
    ]);
  });

  it('a save of the name alone is not', async () => {
    const h = harness(ON_TF_1_0_0);
    await h.svc.updateTournament('t1', { name: 'Sabre Open' } as never, 'u1');
    expect(filtersFor(h.db.from, 'tournaments', 'eq').map(([column]) => column)).not.toContain(
      'updated_at',
    );
  });

  it('refuses 409 when the row was written between the read and the save', async () => {
    // The table's rows, so the row stored can be REPLACED after the read (the double hands back
    // the stored object itself: changing it in place would change what the save read too).
    const stored: Row[] = [structuredClone(ON_TF_1_0_0)];
    const h = harness(ON_TF_1_0_0, {}, { tournaments: { rows: stored } });
    const route = h.db.from.getMockImplementation()!;
    h.db.from.mockImplementation((table: string) => {
      if (table === 'phases') stored[0] = { ...stored[0], updated_at: '2026-10-01T09:05:00.000Z' };
      return route(table);
    });
    const { status, body } = await refusal(h.svc.updateTournament('t1', CAP_9 as never, 'u1'));
    expect([status, body['code']]).toEqual([409, 'rules_changed_since_read']);
  });
});
