import { describe, expect, it } from 'vitest';
import {
  buildMatchFormatFromRow,
  levelChainsFrom,
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
          maxDoubleHitOutcome: 'draw_zero_scores',
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
      maxDoubleHitOutcome: 'draw_zero_scores',
      scoringDirection: 'reverse_zero_loses',
      afterblowMode: 'deductive',
      bestOf: { pool: 1, bracket: 1, finals: 1 },
      levelAtTime: MATCH_FORMAT_DEFAULTS.levelAtTime,
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
        'levelAtTime',
        'maxDoubleHitOutcome',
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

  it('falls back to the default outcome rather than round-tripping an unknown one', () => {
    // The API DTO is `.strict()` and its enum has three members, so a stored
    // value from outside that set would 400 the whole PATCH on the way back.
    const out = buildMatchFormatFromRow(
      {
        matchFormat: { maxDoubleHitOutcome: 'something_else' },
      } as unknown as Partial<WizardMatchFormatRow> & Record<string, unknown>,
      {},
      MATCH_FORMAT_DEFAULTS,
    );

    expect(out.maxDoubleHitOutcome).toBe('double_loss_zero_scores');
  });
});

// Helper type for the partial-row argument used in the unknown-keys test.
interface WizardMatchFormatRow {
  matchFormat?: Partial<WizardMatchFormat>;
}

/**
 * The level-at-time chain, hydrated from a stored row.
 *
 * The API's match-format schema is `.strict()` AND refines the last step, so a
 * shape this hands back unrecognised does not fail loudly — it round-trips into
 * the next PATCH and 400s a save the organiser never asked for.
 */
describe('levelChainsFrom', () => {
  const DEFAULTS = MATCH_FORMAT_DEFAULTS.levelAtTime;

  it('keeps a stored chain the editor can offer', () => {
    const out = levelChainsFrom(
      { bracket: [{ kind: 'extra_time', seconds: 45 }, { kind: 'draw' }] },
      DEFAULTS,
    );
    expect(out.bracket).toEqual([{ kind: 'extra_time', seconds: 45 }, { kind: 'draw' }]);
    // The phases the row said nothing about keep the defaults.
    expect(out.pool).toEqual(DEFAULTS.pool);
    expect(out.finals).toEqual(DEFAULTS.finals);
  });

  it('falls back rather than round-tripping a shape the API refuses', () => {
    // A chain ending in extra time can come back level for ever; the engine
    // and the DTO both reject one, so handing it back to the editor would put
    // the organiser one Save away from a 400 on a field they did not touch.
    expect(levelChainsFrom({ pool: [{ kind: 'extra_time', seconds: 30 }] }, DEFAULTS).pool).toEqual(
      DEFAULTS.pool,
    );
    // An unknown step kind, extra time with no number, and an empty chain.
    expect(levelChainsFrom({ pool: [{ kind: 'coin_toss' }] }, DEFAULTS).pool).toEqual(
      DEFAULTS.pool,
    );
    expect(levelChainsFrom({ pool: [{ kind: 'extra_time' }] }, DEFAULTS).pool).toEqual(
      DEFAULTS.pool,
    );
    expect(levelChainsFrom({ pool: [] }, DEFAULTS).pool).toEqual(DEFAULTS.pool);
    expect(levelChainsFrom(null, DEFAULTS)).toEqual(DEFAULTS);
  });

  it('drops the extra keys a stored step may carry', () => {
    const out = levelChainsFrom(
      { pool: [{ kind: 'extra_time', seconds: 30, note: 'leak' }, { kind: 'sudden_death' }] },
      DEFAULTS,
    );
    expect(JSON.stringify(out)).not.toContain('leak');
  });
});
