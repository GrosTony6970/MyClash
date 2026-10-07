import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { ClockService } from './clock.service';
import { ScoringService } from './scoring.service';

/**
 * Ruling 332: a bout fought to its end, then overridden, gets the score the
 * override found once the clock has put it back in play.
 *
 * Dupont beat Martin 5-3 on the board. An organiser's override wrote 0-5. The
 * referee pressed Reopen: the override was taken back and the 0-5 stayed on
 * the paused bout, beside a sheet of five hits for Dupont. An End before the
 * next hit named Martin.
 */
const BOUT = 'm1';
const HALTED = { status: 'halted' };
const OVERRIDDEN = { id: BOUT, status: 'completed', red_score: 0, blue_score: 5 };
const FOUND = { status: 'completed', red_score: 5, blue_score: 3 };

type Seed = Record<string, unknown>;
const record = (found: Seed, more: Seed = {}) => ({
  match_id: BOUT,
  voided_at: null,
  previous_match_state: found,
  ...more,
});
/** Another overridden bout, seeded FIRST: a read or a write that names no bout finds it. */
const OTHER_BOUT = { id: 'other', status: 'completed', red_score: 1, blue_score: 2 };
const OTHER_RECORD = record(
  { status: 'completed', red_score: 9, blue_score: 9 },
  { match_id: 'other' },
);

function setup(records: Seed[], matches: unknown = { rows: [OTHER_BOUT, OVERRIDDEN] }) {
  const db = mockSupabase({
    matches: matches as never,
    match_forfeits: { rows: [OTHER_RECORD, ...records] },
  });
  const written: number[] = [];
  const clock = {
    clockAction: vi.fn(async () => {
      written.push(writesTo(db, 'matches').length);
      return HALTED;
    }),
    getClockState: vi.fn().mockResolvedValue(HALTED),
  };
  const scoring = new ScoringService(db as never, undefined as never, clock as never);
  const recompute = vi
    .spyOn(scoring, 'recomputeMatchScore')
    .mockResolvedValue({ redScore: 0, blueScore: 0 });
  return { db, clock, scoring, recompute, written };
}

describe('ScoringService.clockAction — the score an override found (ruling 332)', () => {
  it.each<'reopen' | 'start' | 'halt' | 'resume'>(['reopen', 'start', 'halt', 'resume'])(
    'a %s on a bout overridden after its end puts the earlier score back, after the clock',
    async (action) => {
      const { db, scoring, recompute, written } = setup([record(FOUND)]);

      await expect(scoring.clockAction(BOUT, action)).resolves.toBe(HALTED);

      // Nothing was written when the clock was asked: the clock can refuse.
      expect(written).toEqual([0]);
      const writes = writesTo(db, 'matches');
      expect(writes).toHaveLength(1);
      expect(writes[0]?.row).toEqual({
        red_score: 5,
        blue_score: 3,
        updated_at: expect.any(String),
      });
      // Only over the score the override wrote: a hit scored since has its own.
      expect(writes[0]?.filters).toEqual([
        { method: 'eq', args: ['id', BOUT] },
        { method: 'eq', args: ['red_score', 0] },
        { method: 'eq', args: ['blue_score', 5] },
      ]);
      // Its sheet at the cap would end the bout again at once (ruling 323).
      expect(recompute).not.toHaveBeenCalled();
    },
  );

  it('reads the score of the bout with its status', async () => {
    const { db, scoring } = setup([record(FOUND)]);

    await scoring.clockAction(BOUT, 'reopen');

    expect(selectsFor(db.from, 'matches')).toEqual(['status, red_score, blue_score']);
  });

  it('a bout a record cut short keeps reading its sheet, and gets no score back', async () => {
    const { db, scoring, recompute } = setup([
      record({ status: 'paused', red_score: 3, blue_score: 2 }),
    ]);

    await scoring.clockAction(BOUT, 'reopen');

    expect(recompute).toHaveBeenCalledTimes(1);
    expect(writesTo(db, 'matches')).toEqual([]);
  });

  it('a bout the board ended, with no record, gets no score back', async () => {
    const { db, scoring } = setup([]);

    await scoring.clockAction(BOUT, 'reopen');

    expect(writesTo(db, 'matches')).toEqual([]);
  });

  it('an override already taken back gives no score back', async () => {
    const { db, scoring } = setup([record(FOUND, { voided_at: '2026-04-25T09:00:00.000Z' })]);

    await scoring.clockAction(BOUT, 'reopen');

    expect(writesTo(db, 'matches')).toEqual([]);
  });

  it.each<'end' | 'reset_clock'>(['end', 'reset_clock'])(
    '%s gives no score back: it takes no bout out of completed',
    async (action) => {
      const { db, scoring } = setup([record(FOUND)]);

      await scoring.clockAction(BOUT, action);

      expect(writesTo(db, 'matches')).toEqual([]);
    },
  );

  it('a Reopen the clock refuses writes no score', async () => {
    const { db, clock, scoring } = setup([record(FOUND)]);
    clock.clockAction.mockRejectedValue(new Error('correction_later_bout_fought'));

    await expect(scoring.clockAction(BOUT, 'reopen')).rejects.toThrow(
      'correction_later_bout_fought',
    );

    expect(writesTo(db, 'matches')).toEqual([]);
  });

  it('a score that cannot be written does not undo the Reopen', async () => {
    // A canned queue: the read of the bout, then the write that fails.
    const { scoring } = setup(
      [record(FOUND)],
      [
        { data: OVERRIDDEN, error: null },
        { data: null, error: { message: 'down' } },
      ],
    );

    const warned = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(scoring.clockAction(BOUT, 'reopen')).resolves.toBe(HALTED);

    expect(warned.mock.calls.map(([said]) => said)).toEqual([
      "Match m1 kept its record's score after clock reopen",
    ]);
    expect(String(warned.mock.calls[0]?.[1])).toBe(
      "Error: Could not put a match's score back: down",
    );
    warned.mockRestore();
  });

  it('a clinched series under an override gets its last round and that round score back', async () => {
    // The real clock: its Reopen pops the round that ended the series, and the
    // door then writes the score that round closed with.
    const at = (minute: number) => `2026-04-25T09:0${minute}:00.000Z`;
    const closed = (n: number) => ({ round: n, redScore: 5, blueScore: 3, winnerColor: 'red' });
    const db = mockSupabase({
      matches: {
        rows: [
          {
            ...OVERRIDDEN,
            locked_at: null,
            started_at: at(0),
            rounds_json: [closed(1), closed(2)],
            current_round: 2,
            awaiting_round_advance: false,
            red_registration_id: 'red',
            blue_registration_id: 'blue',
            match_number_label: 'T1',
            phases: { type: 'single_elim', tournaments: { ruleset_config: {} } },
          },
        ],
      },
      match_forfeits: { rows: [record(FOUND)] },
      match_events: {
        rows: ['start', 'end'].map((type, i) => ({
          id: `e${i}`,
          match_id: BOUT,
          sequence: i + 1,
          type,
          occurred_at: at(i),
          reason: null,
          adjustment_ms: null,
        })),
      },
    });
    const completion = { onMatchUncompleted: vi.fn().mockResolvedValue(undefined) };
    const clock = new ClockService(db as never, completion as never);
    const scoring = new ScoringService(db as never, undefined as never, clock);

    await scoring.clockAction(BOUT, 'reopen');

    const [reopened, scoreBack] = writesTo(db, 'matches');
    expect(writesTo(db, 'matches')).toHaveLength(2);
    expect(reopened?.row).toMatchObject({
      status: 'paused',
      rounds_json: [closed(1)],
      current_round: 2,
    });
    expect(reopened?.row).not.toHaveProperty('red_score');
    expect(scoreBack?.row).toMatchObject({ red_score: 5, blue_score: 3 });
  });
});
