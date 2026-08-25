import { describe, it, expect } from 'vitest';
import { endRefusal, levelAtTimeRefusal } from './level-at-time-refusal';

/**
 * The refusal body two services now share.
 *
 * The clock refuses a single bout; `ScoringService.endRoundOnTime` refuses a
 * ROUND of a best-of match. That second one used to throw a bare string with no
 * `code`, so `refusal-copy.ts` fell through to `failure.detail` and rendered the
 * server's English on a French referee's tablet. One owner is what stops the two
 * drifting apart again.
 */
const body = (err: { getResponse(): unknown }) => err.getResponse() as Record<string, unknown>;

describe('levelAtTimeRefusal', () => {
  it('names extra time WITH its seconds, which the pad interpolates', () => {
    expect(body(levelAtTimeRefusal({ kind: 'extra_time', seconds: 60 }))).toMatchObject({
      code: 'level_at_time_unresolved',
      remedy: 'extra_time',
      seconds: 60,
    });
  });

  it('names sudden death', () => {
    expect(body(levelAtTimeRefusal({ kind: 'sudden_death' }))).toMatchObject({
      code: 'level_at_time_unresolved',
      remedy: 'sudden_death',
    });
  });

  it('reads a SPENT chain as sudden death already live', () => {
    // Sudden death is terminal, so there is nothing further to advance to: a
    // null step can only mean it is running, and the bout ends when one fighter
    // LEADS — not on the next point, since one exchange can score both.
    expect(body(levelAtTimeRefusal(null))).toMatchObject({
      code: 'level_at_time_unresolved',
      remedy: 'sudden_death',
    });
  });
});

describe('endRefusal', () => {
  it('keeps `time_not_finished` a SEPARATE code', () => {
    // Two different instructions. One code covering both would tell a referee
    // to play sudden death with a minute still on the clock.
    const refusal = body(endRefusal({ reason: 'time_not_finished' }));
    expect(refusal['code']).toBe('time_not_finished');
    expect(refusal['remedy']).toBeUndefined();
  });

  it('delegates a level bout to the chain', () => {
    expect(body(endRefusal({ reason: 'level', step: { kind: 'sudden_death' } }))).toMatchObject({
      code: 'level_at_time_unresolved',
      remedy: 'sudden_death',
    });
  });

  it('carries a message for the logs on every branch', () => {
    // English on purpose — a 4xx body is written for whoever reads the logs,
    // and `refusal-copy.ts` is what keeps it off the tablet.
    for (const refusal of [
      endRefusal({ reason: 'time_not_finished' }),
      endRefusal({ reason: 'level', step: null }),
      endRefusal({ reason: 'level', step: { kind: 'extra_time', seconds: 30 } }),
    ]) {
      expect(String(body(refusal)['message'])).not.toHaveLength(0);
    }
  });
});
