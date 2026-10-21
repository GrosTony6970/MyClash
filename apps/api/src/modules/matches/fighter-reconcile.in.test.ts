import { InternalServerErrorException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { queriedTables, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import type * as MatchRuleset from '../phases/match-ruleset';
import {
  OUT_SINCE,
  anaRow,
  anasTournament,
  bout,
  boutsWritten,
  forfeit,
  inserted,
  voided,
} from './fighter-reconcile.fixtures';

// A bout put back to "not started" reads its Tournament's ruleset: that read has its own tests
// (`match-forfeits.service.restamp.test.ts`), so it answers a fixed one here.
vi.mock('../phases/match-ruleset', async (original) => ({
  ...(await original<typeof MatchRuleset>()),
  tournamentOfBout: vi.fn(() => Promise.resolve('t1')),
  matchRulesetForTournament: vi.fn(() => Promise.resolve({ match_rules_id: 'rules-t1' })),
  restampAfterInsert: vi.fn(() => Promise.resolve()),
}));

/**
 * Once nothing holds a Fighter out, the bouts forfeited because they were out come back (rulings
 * 79, 80, 105-107, 110): every live record the reconcile wrote, and every one a person recorded
 * under a withdrawal voided since. Through the real `FighterStatusService.settle`.
 */

/** What each forfeit left on its bout: what the bout still holds, unless it was fought again. */
const FORFEITED = {
  status: 'completed',
  winner_registration_id: null,
  red_score: 0,
  blue_score: 0,
  end_reason: 'forfeit',
};
const done = (id: string) => ({ ...bout(id, 'pool-1', 'completed'), end_reason: 'forfeit' });

describe('a Fighter back in: the bouts forfeited because she was out come back', () => {
  const seed = () =>
    anasTournament({
      statuses: ['checked_in'],
      bouts: [
        done('m-1'),
        done('m-2'),
        done('m-3'),
        done('m-4'),
        bout('m-running', 'pool-1', 'running'),
        { ...done('m-refought'), end_reason: 'time_limit', winner_registration_id: 'reg-ana' },
      ],
      forfeits: [
        forfeit('a-1', { match_id: 'm-1', auto_created: true, resulting_match_state: FORFEITED }),
        forfeit('a-2', {
          match_id: 'm-2',
          auto_created: true,
          previous_match_state: { status: 'paused', red_score: 2, blue_score: 1 },
          resulting_match_state: FORFEITED,
        }),
        // Put back in play by hand with its record live, and fought again to a result.
        forfeit('a-run', { match_id: 'm-running', auto_created: true }),
        forfeit('a-refought', {
          match_id: 'm-refought',
          auto_created: true,
          resulting_match_state: FORFEITED,
        }),
        // Recorded by hand under a withdrawal since voided (105), and under one still live.
        forfeit('h-voided-root', { match_id: 'm-3', parent_forfeit_id: 'root-gone' }),
        forfeit('h-live-root', { match_id: 'm-4', parent_forfeit_id: 'root-live' }),
        // Ruling 112: one that disqualified on its own is a cause, never an effect. (Live, it
        // holds her out: here a settle landing meanwhile, which the next round settles.)
        forfeit('h-conduct', {
          match_id: 'm-5',
          reason: 'conduct_violation',
          parent_forfeit_id: 'root-gone',
          fighter_outcome: 'disqualified',
        }),
        forfeit('root-gone', { match_id: 'm-0', voided_at: '2026-10-21T12:00:00Z' }),
        forfeit('root-live', { match_id: 'm-9' }),
      ],
    });

  it('voids each of them, stamped as the return’s own void', async () => {
    const { db, settle } = seed();
    const result = await settle();
    expect(voided(db)).toEqual([
      { id: 'a-1', byReturn: true },
      { id: 'a-2', byReturn: true },
      { id: 'a-run', byReturn: true },
      { id: 'a-refought', byReturn: true },
      { id: 'h-voided-root', byReturn: true },
    ]);
    expect(result).toMatchObject({ forfeited: 0, broughtBack: 5 });
  });

  it('puts each bout back as the record found it, but one in play or fought again', async () => {
    const { db, settle } = seed();
    await settle();
    expect(boutsWritten(db)).toEqual(['m-1', 'm-2', 'm-3']);
    expect(writesTo(db, 'matches')[0]!.row).toMatchObject({
      status: 'scheduled',
      match_rules_id: 'rules-t1',
    });
    expect(writesTo(db, 'matches')[1]!.row).toMatchObject({
      status: 'paused',
      red_score: 2,
      blue_score: 1,
    });
  });

  it('reopens the clock the forfeit ended and reads each sheet again (330)', async () => {
    const { deps, settle } = seed();
    deps.clock.getClockState.mockResolvedValue({ status: 'ended' });
    await settle();
    expect(deps.clock.clockAction.mock.calls.map(([id, action]) => [id, action])).toEqual([
      ['m-2', 'reopen'],
    ]);
    expect(deps.scoring.recomputeMatchScore.mock.calls.map(([id]) => id)).toEqual([
      'm-1',
      'm-2',
      'm-3',
    ]);
  });

  it('each bout reads its sheet after its own record is voided; a failed read stops nothing', async () => {
    const { db, deps, settle } = seed();
    const voidedWhenAsked: number[] = [];
    deps.scoring.recomputeMatchScore.mockImplementation(async () => {
      voidedWhenAsked.push(voided(db).length);
      throw new Error('no sheet');
    });
    await settle();
    expect(voidedWhenAsked).toEqual([1, 2, 5]);
    expect(voided(db)).toHaveLength(5);
  });

  it('asks for the column its divergence check reads', async () => {
    // The double returns whole rows whatever the select names: without the column the check
    // reads `{}`, answers null for every record, and a bout fought again is written over.
    const { db, settle } = seed();
    await settle();
    expect(selectsFor(db.from, 'match_forfeits')[0]).toContain('resulting_match_state');
  });

  it('a Fighter in with nothing forfeited costs one read of her records, and writes nothing', async () => {
    const { db, settle } = anasTournament({
      statuses: ['checked_in'],
      forfeits: [forfeit('own', { match_id: 'm-1' })],
    });
    await settle();
    expect(db.writes).toEqual([]);
    expect(queriedTables(db.from)).toEqual(['registrations', 'match_forfeits', 'registrations']);
  });
});

describe('a bout put back faces two Fighters (review B2, M1)', () => {
  const BOB_OUT = { id: 'reg-bob', tournament_id: 't1', status: 'withdrawn', out_since: OUT_SINCE };
  // Seeded as put back already: the double applies no write.
  const putBack = [bout('m-1', 'pool-1', 'scheduled')];

  it('a bout Ana’s return puts back is forfeited by Bob, who is out', async () => {
    const { db, settle } = anasTournament({
      statuses: ['checked_in'],
      others: [BOB_OUT],
      bouts: putBack,
      forfeits: [forfeit('a-1', { match_id: 'm-1', auto_created: true })],
    });
    const result = await settle();
    expect(voided(db)).toEqual([{ id: 'a-1', byReturn: true }]);
    expect(inserted(db)).toEqual([
      expect.objectContaining({
        match_id: 'm-1',
        forfeiting_registration_id: 'reg-bob',
        reason: 'voluntary',
        auto_created: true,
      }),
    ]);
    expect(result).toMatchObject({ forfeited: 1, broughtBack: 1 });
  });

  it('so is a bout the door put back (a take-back)', async () => {
    const { db, settle } = anasTournament({
      statuses: ['checked_in'],
      others: [BOB_OUT],
      bouts: putBack,
    });
    await settle({ boutsPutBack: ['m-1'] });
    expect(inserted(db).map((row) => row['forfeiting_registration_id'])).toEqual(['reg-bob']);
  });

  it('Bob’s own put-back of that bout, in his spell out, still holds', async () => {
    const { db, settle } = anasTournament({
      statuses: ['checked_in'],
      others: [BOB_OUT],
      bouts: putBack,
      forfeits: [
        forfeit('b-hand', {
          match_id: 'm-1',
          forfeiting_registration_id: 'reg-bob',
          auto_created: true,
          voided_at: '2026-10-21T11:00:00.000Z',
        }),
      ],
    });
    await settle({ boutsPutBack: ['m-1'] });
    expect(inserted(db)).toEqual([]);
  });

  it('Bob’s own settle landing meanwhile: his loop reads him again and follows (fold f1)', async () => {
    const row = (id: string, status: string) => ({
      data: [{ ...anaRow(status), id }],
      error: null,
    });
    const { db, settle } = anasTournament({
      statuses: ['checked_in'],
      bouts: putBack,
      forfeits: [
        forfeit('b-auto', {
          match_id: 'm-9',
          forfeiting_registration_id: 'reg-bob',
          auto_created: true,
        }),
      ],
      registrationsTable: [
        row('reg-ana', 'checked_in'), // Ana, after her settle
        row('reg-ana', 'checked_in'), // Ana, again: she stays in
        row('reg-bob', 'withdrawn'), // the opponents of the bout put back
        row('reg-bob', 'withdrawn'), // Bob, as his follow starts
        row('reg-bob', 'checked_in'), // Bob, again: his undo landed
        row('reg-bob', 'checked_in'), // Bob, after his bring-back
      ],
    });
    await settle({ boutsPutBack: ['m-1'] });
    expect(voided(db)).toEqual([{ id: 'b-auto', byReturn: true }]);
  });

  it('an opponent who is in plays it', async () => {
    const { db, settle } = anasTournament({
      statuses: ['checked_in'],
      others: [{ ...BOB_OUT, status: 'checked_in', out_since: null }],
      bouts: putBack,
    });
    await settle({ boutsPutBack: ['m-1'] });
    expect(inserted(db)).toEqual([]);
  });
});

describe('a forfeit recorded under the organiser’s hand withdrawal (ruling 118)', () => {
  it('comes back with her: the undo voids it, but not a forfeit of her own', async () => {
    const { db, settle } = anasTournament({
      statuses: ['checked_in'],
      bouts: [done('m-6'), done('m-7')],
      forfeits: [
        forfeit('h-hand', { match_id: 'm-6', under_hand_withdrawal: true }),
        forfeit('h-own', { match_id: 'm-7' }),
      ],
    });
    await settle();
    expect(voided(db)).toEqual([{ id: 'h-hand', byReturn: true }]);
  });
});

describe('a bring-back the database refuses', () => {
  it('a bout it cannot read is a server error, never "not fought again"', async () => {
    const { db, settle } = anasTournament({
      statuses: ['checked_in'],
      forfeits: [
        forfeit('a-1', { match_id: 'm-1', auto_created: true, resulting_match_state: FORFEITED }),
      ],
      matchesTable: [
        { data: [{ id: 'm-1', status: 'completed' }], error: null },
        { data: null, error: { message: 'connection lost' } },
      ],
    });
    await expect(settle()).rejects.toThrow('Match m-1 could not be read: connection lost');
    expect(voided(db)).toEqual([]);
  });

  it('a bout it cannot put back is a server error, before its record is voided', async () => {
    const { db, settle } = anasTournament({
      statuses: ['checked_in'],
      forfeits: [
        forfeit('a-1', {
          match_id: 'm-1',
          auto_created: true,
          previous_match_state: { status: 'paused' },
        }),
      ],
      matchesTable: [
        { data: [{ id: 'm-1', status: 'completed' }], error: null },
        { data: null, error: { message: 'a lock' } },
      ],
    });
    await expect(settle()).rejects.toThrow('Match m-1 was not put back: a lock');
    expect(voided(db)).toEqual([]);
  });
});

describe('a status that moves while the bouts follow it', () => {
  it('follows it again: out, then in', async () => {
    const { db, settle } = anasTournament({
      statuses: ['withdrawn', 'checked_in', 'checked_in'],
    });
    await settle();
    expect(inserted(db).map((row) => row['match_id'])).toEqual(['m-scheduled', 'm-paused']);
    expect(queriedTables(db.from).filter((table) => table === 'registrations')).toHaveLength(3);
  });

  it('a status that keeps moving is a server error, for the pad to send again', async () => {
    const { settle } = anasTournament({
      statuses: ['withdrawn', 'checked_in', 'withdrawn', 'checked_in'],
    });
    await expect(settle()).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
