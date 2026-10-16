import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseRow } from '../../common/testing/supabase-chain';
import { BOUT, NOW, row, type setup } from './clock-late-press.fixtures';
import { SPENT, STAFF, lateStep, level, taken } from './level-step.fixtures';
import { OPEN, advance, series as waitingSeries } from './round-advance.fixtures';
import { ROUND_1_CLOSED, endRound, series as roundSeries } from './round-end.fixtures';

/**
 * A row another device writes while a late round press is judged (S11), on the three paths that
 * share the clock's `judgedSequence`: a level step, "Start round" and "End round".
 *
 * Each late press takes its sequence BEFORE the reads that judge it. The other device's row then
 * takes that sequence first, the late insert collides, and every rule is asked again with that
 * row in sight. Taken at the insert, the sequence was free: the late press was written past
 * rules that never saw the other device's row.
 */
beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW) });
});
afterEach(() => {
  vi.useRealTimers();
});

type Db = ReturnType<typeof setup>['db'];

/** The timeline keeps its unique key on (bout, sequence), as the database. */
function keyedTimeline(db: Db, rows: SupabaseRow[]): void {
  const real = db.service.from;
  db.service.from = vi.fn((table: string) => {
    const chain = real(table);
    if (table !== 'match_events') return chain;
    const insert = chain.insert;
    chain.insert = vi.fn((written: SupabaseRow) => {
      if (rows.some((held) => held['sequence'] === written['sequence'])) {
        return Promise.resolve({ error: { code: '23505', message: 'duplicate key value' } });
      }
      rows.push(written);
      return insert(written);
    }) as never;
    return chain;
  }) as never;
}

/** `write` lands once, just after the door's first read of `table`: that read keeps what it got. */
function landsAfterFirstRead(db: Db, table: string, write: () => void): void {
  const real = db.service.from;
  let landed = false;
  db.service.from = vi.fn((asked: string) => {
    const chain = real(asked);
    if (asked === table && !landed) {
      landed = true;
      write();
    }
    return chain;
  }) as never;
}

describe('a late round press — another device writes while it is judged', () => {
  it('a level step: the other tablet takes the step after the clock read; no second step', async () => {
    const { db, rows, clock } = level(SPENT);
    keyedTimeline(db, rows);
    const readClock = clock.getClockState.bind(clock);
    let landed = false;
    vi.spyOn(clock, 'getClockState').mockImplementation(async (matchId: string) => {
      const state = await readClock(matchId);
      if (!landed) {
        landed = true;
        rows.push(taken(3, '10:01:35', { client_uuid: 'other-tablet' }));
      }
      return state;
    });

    const answer = await clock.advanceLevelResolution(BOUT, STAFF, lateStep('10:01:40'));

    expect(answer.levelResolutionSteps).toBe(1);
    expect(db.writes).toEqual([]);
  });

  it('"Start round 2": the desk opens the round after the bout read; no second advance', async () => {
    const { db, rows, bouts, scoring } = waitingSeries();
    keyedTimeline(db, rows);
    landsAfterFirstRead(db, 'matches', () => {
      rows.push(row(3, 'round_advance', '11:00:00'));
      bouts[0] = { ...bouts[0], ...OPEN };
    });

    const answer = await scoring.advanceRound(BOUT, STAFF, advance('10:05:00'));

    expect(answer).toEqual({ currentRound: 2 });
    expect(db.writes).toEqual([]);
  });

  it('"End round 1": the desk ends the round after the bout read; no second end', async () => {
    const { db, rows, bouts, scoring } = roundSeries();
    keyedTimeline(db, rows);
    landsAfterFirstRead(db, 'matches', () => {
      rows.push(row(2, 'round_end', '11:00:00'), row(3, 'halt', '11:00:00'));
      bouts[0] = { ...bouts[0], ...ROUND_1_CLOSED, status: 'paused' };
    });

    const answer = await scoring.endRoundOnTime(BOUT, STAFF, endRound('10:01:30'));

    expect(answer).toEqual({ redScore: 1, blueScore: 2 });
    expect(db.writes).toEqual([]);
  });
});
