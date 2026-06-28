import { describe, expect, it } from 'vitest';
import {
  buildMatchFormatFromRow,
  type WizardMatchFormat,
  MATCH_FORMAT_DEFAULTS,
} from './buildMatchFormatFromRow';

describe('buildMatchFormatFromRow', () => {
  it('returns defaults when the row is empty', () => {
    expect(buildMatchFormatFromRow({}, {}, MATCH_FORMAT_DEFAULTS)).toEqual(MATCH_FORMAT_DEFAULTS);
  });

  it('hydrates known matchFormat fields and afterblowMode from scoringConfig', () => {
    const out = buildMatchFormatFromRow(
      {
        matchFormat: {
          pointCap: 7,
          timerMode: 'countup',
          timeLimitsSeconds: { pool: 200, bracket: 250, finals: 300 },
          softClockLimitSeconds: 45,
          maxDoubleHits: 4,
          scoringDirection: 'reverse_zero_loses',
        },
      },
      { afterblowMode: 'deductive' },
      MATCH_FORMAT_DEFAULTS,
    );
    expect(out).toEqual({
      pointCap: 7,
      timerMode: 'countup',
      timeLimitsSeconds: { pool: 200, bracket: 250, finals: 300 },
      softClockLimitSeconds: 45,
      maxDoubleHits: 4,
      scoringDirection: 'reverse_zero_loses',
      afterblowMode: 'deductive',
      bestOf: { pool: 1, bracket: 1, finals: 1 },
    });
  });

  it('discards unknown keys at any depth', () => {
    const out = buildMatchFormatFromRow(
      {
        matchFormat: {
          pointCap: 5,
          timeLimitsSeconds: { pool: 180, warmupSeconds: 42 },
          legacyKey: 'remove me',
        },
        forfeitPolicy: { reasons: { injury: {} } },
      } as unknown as Partial<WizardMatchFormatRow> & Record<string, unknown>,
      { afterblowMode: 'full', extra: 'leak' } as Record<string, unknown>,
      MATCH_FORMAT_DEFAULTS,
    );

    const json = JSON.stringify(out);
    expect(json).not.toContain('warmupSeconds');
    expect(json).not.toContain('legacyKey');
    expect(json).not.toContain('reasons');
    expect(json).not.toContain('"extra"');
    expect(Object.keys(out).sort()).toEqual(
      [
        'afterblowMode',
        'bestOf',
        'maxDoubleHits',
        'pointCap',
        'scoringDirection',
        'softClockLimitSeconds',
        'timeLimitsSeconds',
        'timerMode',
      ].sort(),
    );
    expect(Object.keys(out.timeLimitsSeconds).sort()).toEqual(['bracket', 'finals', 'pool']);
  });
});

// Helper type for the partial-row argument used in the unknown-keys test.
interface WizardMatchFormatRow {
  matchFormat?: Partial<WizardMatchFormat>;
}
