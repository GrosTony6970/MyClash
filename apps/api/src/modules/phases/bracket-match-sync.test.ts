import { describe, it, expect } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { mockSupabase, writesTo, type SupabaseRow } from '../../common/testing/supabase-chain';
import { assertSlotMatchRewritable, loadSlotMatch, syncMatchToSlot } from './bracket-match-sync';
import { rulesOf, withStampedRules } from './match-rules.fixtures';

/**
 * The voided-row precondition `hasBeenFought` is written against.
 *
 * `fought-match.ts` returns true for a voided bout whose clock had started, and
 * says so in its docstring — it is safe only because "callers exclude voided rows
 * before asking. Both do, at the query". Two queries carry that guard:
 * `dependentClosure` in bracket-dependents.ts, and `loadSlotMatch` here.
 *
 * A falsification sweep over every filter in this module found the second one
 * unguarded: dropping `.not('status', 'eq', 'voided')` from `loadSlotMatch` left
 * all 3,659 API tests green. (The first is covered, by *ignores voided history
 * rows and reports the slot as having no live match* in bracket-dependents.test.ts.)
 *
 * These are OUTCOME assertions, not argument assertions, which is why they are
 * here and not bolted onto bracket-advance.service.test.ts: that file's local
 * double is canned, and a canned double ignores filters entirely — no filter can
 * be load-bearing in a test whose fixture cannot narrow. A seeded `rows:` table
 * applies `.eq` and `.not` for real, so the row simply is not there.
 */

const client = (rows: SupabaseRow[]) =>
  mockSupabase(...withStampedRules({ matches: { rows } })).service as never;

/** A bout that ran and was then voided — the exact row the precondition excludes. */
const VOIDED_BUT_RAN: SupabaseRow = {
  id: 'm-voided',
  bracket_slot_id: 'slot-1',
  status: 'voided',
  started_at: '2026-08-17T10:00:00Z',
};

const LIVE_RUNNING: SupabaseRow = {
  id: 'm-live',
  bracket_slot_id: 'slot-1',
  status: 'running',
  started_at: '2026-08-17T11:00:00Z',
};

describe('loadSlotMatch', () => {
  it('does not return a voided row, however far that bout got', async () => {
    expect(await loadSlotMatch(client([VOIDED_BUT_RAN]), 'slot-1')).toBeNull();
  });

  it('returns the live row for the slot', async () => {
    const found = await loadSlotMatch(client([VOIDED_BUT_RAN, LIVE_RUNNING]), 'slot-1');
    expect(found?.id).toBe('m-live');
  });

  it('does not reach across slots', async () => {
    const other = { ...LIVE_RUNNING, id: 'm-elsewhere', bracket_slot_id: 'slot-2' };
    expect(await loadSlotMatch(client([other]), 'slot-1')).toBeNull();
  });
});

describe('assertSlotMatchRewritable', () => {
  /**
   * The one that matters. `hasBeenFought('voided', <non-null started_at>)` is
   * TRUE — the predicate is deliberately blind to voiding — so if the query stops
   * excluding voided rows, an operator can no longer edit a slot whose only bout
   * was cancelled. The bracket would be frozen by a bout nobody fought.
   */
  it('lets an operator edit a slot whose only bout was voided', async () => {
    await expect(
      assertSlotMatchRewritable(client([VOIDED_BUT_RAN]), 'slot-1'),
    ).resolves.toBeUndefined();
  });

  it('refuses when the slot has a live bout under way', async () => {
    await expect(
      assertSlotMatchRewritable(client([LIVE_RUNNING]), 'slot-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows the edit when the slot has no bout at all', async () => {
    await expect(assertSlotMatchRewritable(client([]), 'slot-1')).resolves.toBeUndefined();
  });
});

describe('syncMatchToSlot — a new bout of the slot', () => {
  // A change of the Tournament's rules between the stamp read and the insert misses the new
  // bout, so the bout is stamped again once it is in (R3).
  it('re-stamps it with the ruleset in force once it is in', async () => {
    const supabase = mockSupabase(
      ...withStampedRules({
        matches: { rows: [] },
        phases: { rows: [{ id: 'ph-1', tournament_id: 't-1' }] },
        tournaments: {
          rows: [{ id: 't-1', ruleset_code: 'Generic_PointsCap', ruleset_version: '1' }],
        },
      }),
    );
    // How many bouts were written when each stamp was asked.
    const boutsInAtStamp: number[] = [];
    const stamp = supabase.rpc.getMockImplementation();
    supabase.rpc.mockImplementation(async (name, args) => {
      boutsInAtStamp.push(writesTo(supabase, 'matches').length);
      return stamp!(name, args);
    });
    const slot = {
      id: 'slot-1',
      phase_id: 'ph-1',
      position: 1,
      source_b_type: 'seed',
      registration_a_id: 'r-a',
      registration_b_id: 'r-b',
    };

    await syncMatchToSlot(supabase.service as never, slot, { onStarted: 'skip' });

    const writes = writesTo(supabase, 'matches');
    // The database moves the bouts not started; the server writes only the insert.
    expect(writes.map((write) => write.op)).toEqual(['insert']);
    expect(writes[0]?.row).toMatchObject({ match_rules_id: rulesOf('t-1') });
    // The copy holds the pair; the bout's row carries none of its own.
    expect(writes[0]?.row).not.toHaveProperty('ruleset_code');
    expect(writes[0]?.row).not.toHaveProperty('ruleset_version');
    expect(writes[0]?.row).not.toHaveProperty('ruleset_content_hash');
    // The stamp for the insert, then the stamp again once the bout is in.
    expect(supabase.rpc.mock.calls).toEqual([
      ['stamp_match_rules', { p_tournament_id: 't-1' }],
      ['stamp_match_rules', { p_tournament_id: 't-1' }],
    ]);
    expect(boutsInAtStamp).toEqual([0, 1]);
  });
});
