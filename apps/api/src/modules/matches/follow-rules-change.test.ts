/**
 * The Fighters follow an audited forfeit rules change (`follow-rules-change.ts`; operator rulings
 * 143, 146, 149, 153, 157-160): the order is the database's, a Fighter going out who shares an
 * unfought bout with a failed or held one is held, the second loop retries the failed first, and
 * what is still failed or held is `notSettled`.
 *
 * The database's answer is a function of its arguments (`fighters_status_under`): loop 1 asks
 * before → after; loop 2 asks under the rules after alone (`p_rules_before` equals
 * `p_rules_after`), and answers the seeded out-of-step Fighters plus those it is named, sorted by
 * `crossed_at` then id, as the SQL does (probe check 19 holds the SQL). The bouts are read through
 * the one reader, `unfoughtBoutsOf`, spied on here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChainResult } from '../../common/testing/supabase-chain';
import { unfoughtBoutsOf } from './fighter-reconcile';
import { followRulesChangeOf, type RulesMove, type StatusRow } from './follow-rules-change';

vi.mock('./fighter-reconcile', () => ({ unfoughtBoutsOf: vi.fn() }));
const boutsOf = vi.mocked(unfoughtBoutsOf);

const BEFORE = { disqualifyAfter: null };
const AFTER = { disqualifyAfter: 2 };
const CHANGE: RulesMove = { before: BEFORE, after: AFTER, beforeUnparsable: false };
/** A repair: the rules before did not parse, so both sides are the rules after. */
const REPAIR: RulesMove = { before: AFTER, after: AFTER, beforeUnparsable: true };

const out = (id: string, crossed: string): StatusRow => ({
  registration_id: id,
  status_now: 'registered',
  status_before: 'registered',
  status_after: 'disqualified',
  crossed_at: `2026-10-21T${crossed}:00Z`,
});
const back = (id: string): StatusRow => ({
  registration_id: id,
  status_now: 'disqualified',
  status_before: 'disqualified',
  status_after: 'registered',
  crossed_at: null,
});
/** Stale: out under the rules before and after alike, never settled. */
const stale = (id: string, crossed: string): StatusRow => ({
  ...out(id, crossed),
  status_before: 'disqualified',
});

const PAUL = out('reg-paul', '10:00');
const JEAN = out('reg-jean', '10:05');
const MARC = out('reg-marc', '10:10');
const LUC = out('reg-luc', '10:20');
const ANN = stale('reg-ann', '09:50');
const INA = back('reg-ina');

/** The unfought bouts, each a pair of corners. */
const bout = (red: string, blue: string) => ({
  id: `${red}-${blue}`,
  red_registration_id: red,
  blue_registration_id: blue,
});

interface World {
  /** What loop 1's read answers, in this order. */
  loop1: StatusRow[];
  /** The Fighters out of step with the rules after, whom loop 2 finds on its own. */
  outOfStep?: StatusRow[];
  bouts?: Array<ReturnType<typeof bout>>;
  /** Each Fighter's settle: throws `always`, `once` (the first time), or `later` (after the first). */
  failing?: Record<string, 'always' | 'once' | 'later'>;
  /** The change followed; `CHANGE` when absent. */
  change?: RulesMove;
  readFails?: { loop1?: boolean; loop2?: boolean };
  /** Whose bout read fails. */
  boutReadFails?: string[];
}

const sorted = (rows: StatusRow[]) =>
  [...rows].sort(
    (a, b) =>
      (a.crossed_at ?? '￿').localeCompare(b.crossed_at ?? '￿') ||
      a.registration_id.localeCompare(b.registration_id),
  );

function world(w: World) {
  const known = new Map([...w.loop1, ...(w.outOfStep ?? [])].map((r) => [r.registration_id, r]));
  const reads: Record<string, unknown>[] = [];
  const rpc = vi.fn(async (_name: string, args: Record<string, unknown>): Promise<ChainResult> => {
    reads.push(args);
    // Loop 1 reads first, always; in a repair both reads are under the rules after alone.
    const loop2 = reads.length > 1;
    if (loop2 ? w.readFails?.loop2 : w.readFails?.loop1) {
      return { data: null, error: { message: 'timeout' } };
    }
    if (!loop2) return { data: w.loop1, error: null };
    const ids = new Set([
      ...(w.outOfStep ?? []).map((r) => r.registration_id),
      ...(args['p_also'] as string[]),
    ]);
    return { data: sorted([...ids].map((id) => known.get(id)!)), error: null };
  });
  boutsOf.mockImplementation(async (_db, _t, id) => {
    if (w.boutReadFails?.includes(id)) throw new Error(`bouts of ${id} not read`);
    return (w.bouts ?? []).filter(
      (b) => b.red_registration_id === id || b.blue_registration_id === id,
    );
  });
  const tried = new Set<string>();
  const settled: string[] = [];
  const settle = vi.fn(async (id: string) => {
    settled.push(id);
    const how = w.failing?.[id];
    const again = tried.has(id);
    tried.add(id);
    if (how === 'always' || (how === 'once' && !again) || (how === 'later' && again)) {
      throw new Error(`settle of ${id} failed`);
    }
  });
  const run = () =>
    followRulesChangeOf(
      { db: { rpc } as never, settle, logged: vi.fn() },
      't1',
      w.change ?? CHANGE,
    );
  return { run, reads, settle, settled };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the order of a rules change’s follow', () => {
  it('settles those going out in the database’s order, then those coming back: it sorts nothing', async () => {
    // Answered in the REVERSE of crossing order, those coming back first.
    const w = world({ loop1: [INA, JEAN, PAUL] });
    const followed = await w.run();

    expect(w.settled).toEqual(['reg-jean', 'reg-paul', 'reg-ina']);
    expect(followed).toEqual({ notSettled: [], inStep: [], followFailed: false });
  });

  it('asks loop 1 under the rules before and after, loop 2 under the rules after alone', async () => {
    const w = world({ loop1: [PAUL] });
    await w.run();

    expect(w.reads).toEqual([
      { p_tournament: 't1', p_rules_before: BEFORE, p_rules_after: AFTER, p_also: [] },
      { p_tournament: 't1', p_rules_before: AFTER, p_rules_after: AFTER, p_also: [] },
    ]);
  });

  it('reads no bout while nothing failed, even of two Fighters on one bout', async () => {
    const w = world({ loop1: [PAUL, JEAN], bouts: [bout('reg-paul', 'reg-jean')] });
    await w.run();

    expect(w.settled).toEqual(['reg-paul', 'reg-jean']);
    expect(boutsOf).not.toHaveBeenCalled();
  });

  it('settles in loop 2 a Fighter only it finds out of step, and answers them as brought in step', async () => {
    const w = world({ loop1: [PAUL], outOfStep: [ANN] });
    const followed = await w.run();

    expect(w.settled).toEqual(['reg-paul', 'reg-ann']);
    expect(followed.inStep).toEqual(['reg-ann']);
  });

  it('answers a Fighter settled in loop 1 who fails in loop 2 as not settled, not in step', async () => {
    // Ann settles in loop 1; a write in between puts her out of step again, and loop 2 fails her.
    const w = world({ loop1: [ANN], outOfStep: [ANN], failing: { 'reg-ann': 'later' } });
    const followed = await w.run();

    expect(w.settled).toEqual(['reg-ann', 'reg-ann']);
    expect(followed).toEqual({ notSettled: ['reg-ann'], inStep: [], followFailed: false });
  });
});

describe('who the change moved, as the dialog named them (ruling 161)', () => {
  // Out of step under the rules after: loop 1 lists Ann whatever the rules before.
  it('a change: Ann, out under both sides, was not moved by it: brought back in step', async () => {
    const followed = await world({ loop1: [ANN] }).run();

    expect(followed.inStep).toEqual(['reg-ann']);
  });

  it('a repair: the dialog named Ann as moved, so no one is brought back in step', async () => {
    const w = world({ loop1: [ANN], change: REPAIR });
    const followed = await w.run();

    expect(w.settled).toEqual(['reg-ann']);
    expect(w.reads[0]).toEqual({
      p_tournament: 't1',
      p_rules_before: AFTER,
      p_rules_after: AFTER,
      p_also: [],
    });
    expect(followed).toEqual({ notSettled: [], inStep: [], followFailed: false });
  });
});

describe('the hold-back (rulings 153, 158)', () => {
  it('holds a later Fighter on an unfought bout with a failed one, and loop 2 retries the failed first', async () => {
    const w = world({
      loop1: [PAUL, JEAN],
      outOfStep: [JEAN],
      bouts: [bout('reg-paul', 'reg-jean')],
      failing: { 'reg-paul': 'always' },
    });
    const followed = await w.run();

    expect(w.reads[1]!['p_also']).toEqual(['reg-paul', 'reg-jean']);
    expect(w.settled).toEqual(['reg-paul', 'reg-paul']);
    expect(followed.notSettled).toEqual(['reg-paul', 'reg-jean']);
  });

  it('settles Ann, then Paul’s retry, then Jean, once Paul settles in loop 2 (ruling 157)', async () => {
    const w = world({
      loop1: [PAUL, JEAN],
      outOfStep: [ANN],
      bouts: [bout('reg-paul', 'reg-jean'), bout('reg-ann', 'reg-paul')],
      failing: { 'reg-paul': 'once' },
    });
    const followed = await w.run();

    expect(w.settled).toEqual(['reg-paul', 'reg-ann', 'reg-paul', 'reg-jean']);
    expect(followed.notSettled).toEqual([]);
  });

  it('follows the chain: one held behind a held Fighter is held too (ruling 158)', async () => {
    const w = world({
      loop1: [PAUL, JEAN, MARC],
      bouts: [bout('reg-paul', 'reg-jean'), bout('reg-jean', 'reg-marc')],
      failing: { 'reg-paul': 'always' },
    });
    const followed = await w.run();

    expect(w.settled).toEqual(['reg-paul', 'reg-paul']);
    expect(followed.notSettled).toEqual(['reg-paul', 'reg-jean', 'reg-marc']);
  });

  it('settles a later Fighter whose unfought bout faces no one failed or held', async () => {
    const w = world({
      loop1: [PAUL, JEAN, LUC],
      bouts: [bout('reg-paul', 'reg-jean'), bout('reg-luc', 'reg-other')],
      failing: { 'reg-paul': 'always' },
    });
    const followed = await w.run();

    expect(w.settled).toContain('reg-luc');
    expect(followed.notSettled).toEqual(['reg-paul', 'reg-jean']);
  });

  it('never holds a Fighter coming back, even on an unfought bout with a failed one', async () => {
    const w = world({
      loop1: [PAUL, INA],
      bouts: [bout('reg-paul', 'reg-ina')],
      failing: { 'reg-paul': 'always' },
    });
    const followed = await w.run();

    expect(w.settled.filter((id) => id === 'reg-ina')).toEqual(['reg-ina']);
    expect(followed.notSettled).toEqual(['reg-paul']);
  });

  it('reads the bouts of each Fighter going out after the first failure, through the one reader', async () => {
    const w = world({
      loop1: [PAUL, JEAN, LUC],
      bouts: [bout('reg-paul', 'reg-jean')],
      failing: { 'reg-paul': 'always' },
    });
    await w.run();

    // Loop 1: Jean and Luc; loop 2 (Paul, Jean named): Jean.
    expect(boutsOf.mock.calls.map(([, t, id]) => [t, id])).toEqual([
      ['t1', 'reg-jean'],
      ['t1', 'reg-luc'],
      ['t1', 'reg-jean'],
    ]);
  });

  it('holds every later Fighter going out when a bout read fails, in both loops', async () => {
    const w = world({
      loop1: [PAUL, JEAN, LUC],
      bouts: [],
      failing: { 'reg-paul': 'always' },
      boutReadFails: ['reg-jean'],
    });
    const followed = await w.run();

    expect(w.settled).toEqual(['reg-paul', 'reg-paul']);
    expect(followed).toEqual({
      notSettled: ['reg-paul', 'reg-jean', 'reg-luc'],
      inStep: [],
      followFailed: true,
    });
  });
});

describe('a read of the Fighters that fails', () => {
  it('in loop 2: retries loop 1’s failed and held in loop 1’s order (ruling 160A)', async () => {
    const w = world({
      loop1: [PAUL, JEAN],
      bouts: [bout('reg-paul', 'reg-jean')],
      failing: { 'reg-paul': 'once' },
      readFails: { loop2: true },
    });
    const followed = await w.run();

    expect(w.settled).toEqual(['reg-paul', 'reg-paul', 'reg-jean']);
    expect(followed).toEqual({ notSettled: [], inStep: [], followFailed: true });
  });

  it('in loop 1: settles whom loop 2 finds out of step, and says the follow failed', async () => {
    const w = world({ loop1: [PAUL], outOfStep: [ANN], readFails: { loop1: true } });
    const followed = await w.run();

    expect(w.settled).toEqual(['reg-ann']);
    expect(followed).toEqual({ notSettled: [], inStep: [], followFailed: true });
  });
});
