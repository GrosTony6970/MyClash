import { describe, expect, it } from 'vitest';
import {
  displayClockMs,
  effectiveTimeLimitSeconds,
  formatClockMs,
  isMedalMatchLabel,
  shouldWarnClock,
  type PhaseType,
} from './match-clock';
import { DEFAULT_MATCH_FORMAT_CONFIG, type MatchFormatConfig } from './scoring-config';

/** Distinct limit per phase so a wrong dispatch can't accidentally pass. */
const CONFIG: MatchFormatConfig = {
  ...DEFAULT_MATCH_FORMAT_CONFIG,
  timeLimitsSeconds: { pool: 90, swiss: 120, bracket: 180, finals: 240 },
};

/** A config written before Swiss existed: no `swiss` key at all. */
const PRE_SWISS: MatchFormatConfig = {
  ...DEFAULT_MATCH_FORMAT_CONFIG,
  timeLimitsSeconds: { pool: 90, bracket: 180, finals: 240 },
};

describe('effectiveTimeLimitSeconds', () => {
  const cases: Array<[PhaseType | undefined, string | null, number | null]> = [
    ['pool', 'P1-M3', 90],
    ['pool', 'F', 90], // phase wins over the label: a pool has no medal match
    ['swiss', 'S2-M1', 120],
    ['single_elim', 'QF-M1', 180],
    ['double_elim', 'LB2-M4', 180],
    ['single_elim', 'F', 240],
    ['single_elim', 'BRONZE', 240],
    ['double_elim', 'Gold Medal Match', 240],
    [undefined, 'QF-M1', 180],
    [undefined, null, 180],
  ];

  it.each(cases)('phase=%s label=%s → %s', (phaseType, label, expected) => {
    expect(effectiveTimeLimitSeconds(CONFIG, phaseType, label)).toBe(expected);
  });

  it('falls back to the POOL limit for Swiss when the config predates Swiss', () => {
    // Not `bracket`: a Swiss round is a group stage. This is the exact rule
    // getEffectiveMatchTimeLimitSeconds applies in @myclash/rulesets.
    expect(effectiveTimeLimitSeconds(PRE_SWISS, 'swiss', 'S1-M1')).toBe(90);
  });

  it('returns null when the phase has no limit', () => {
    const unlimited: MatchFormatConfig = {
      ...CONFIG,
      timeLimitsSeconds: { pool: null, swiss: null, bracket: null, finals: null },
    };
    expect(effectiveTimeLimitSeconds(unlimited, 'pool', null)).toBeNull();
  });
});

describe('isMedalMatchLabel', () => {
  it.each(['F', 'final', ' Gold ', 'GOLD MEDAL MATCH', '3rd', 'Bronze', 'BRONZE MEDAL MATCH'])(
    'accepts %s',
    (label) => expect(isMedalMatchLabel(label)).toBe(true),
  );

  it.each([null, undefined, '', 'SF', 'QF-M1', 'FINALE'])('rejects %s', (label) =>
    expect(isMedalMatchLabel(label)).toBe(false),
  );
});

describe('displayClockMs', () => {
  const countdown = { ...CONFIG, timerMode: 'countdown' as const };
  const countup = { ...CONFIG, timerMode: 'countup' as const };

  it('counts down from the phase limit', () => {
    expect(displayClockMs(30_000, countdown, 'pool', null)).toBe(60_000);
    expect(displayClockMs(30_000, countdown, 'swiss', null)).toBe(90_000);
    expect(displayClockMs(30_000, countdown, 'single_elim', 'F')).toBe(210_000);
  });

  it('clamps at zero once the limit is spent', () => {
    expect(displayClockMs(120_000, countdown, 'pool', null)).toBe(0);
  });

  it('returns elapsed unchanged in count-up mode', () => {
    expect(displayClockMs(30_000, countup, 'pool', null)).toBe(30_000);
  });

  it('returns elapsed when the phase has no limit, even in countdown mode', () => {
    const unlimited: MatchFormatConfig = {
      ...countdown,
      timeLimitsSeconds: { pool: null, swiss: null, bracket: null, finals: null },
    };
    expect(displayClockMs(30_000, unlimited, 'pool', null)).toBe(30_000);
  });

  it('never renders a negative clock', () => {
    expect(displayClockMs(-5_000, countup, 'pool', null)).toBe(0);
  });
});

describe('shouldWarnClock', () => {
  it('warns inside the last 10 seconds of the phase limit', () => {
    expect(shouldWarnClock(79_999, CONFIG, 'pool', null)).toBe(false);
    expect(shouldWarnClock(80_001, CONFIG, 'pool', null)).toBe(true);
    expect(shouldWarnClock(999_999, CONFIG, 'pool', null)).toBe(true);
  });

  it('warns in count-up mode too — the bout still ends at the limit', () => {
    expect(shouldWarnClock(85_000, { ...CONFIG, timerMode: 'countup' }, 'pool', null)).toBe(true);
  });

  it('never warns when the phase has no limit', () => {
    const unlimited: MatchFormatConfig = {
      ...CONFIG,
      timeLimitsSeconds: { pool: null, swiss: null, bracket: null, finals: null },
    };
    expect(shouldWarnClock(10_000_000, unlimited, 'pool', null)).toBe(false);
  });
});

describe('formatClockMs', () => {
  it.each([
    [0, '00:00:00'],
    [1_500, '00:01:50'],
    [61_230, '01:01:23'],
    [3_600_000, '60:00:00'],
    [-1, '00:00:00'],
  ])('%s ms → %s', (ms, expected) => expect(formatClockMs(ms)).toBe(expected));
});
