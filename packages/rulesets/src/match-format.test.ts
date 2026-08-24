import { describe, expect, it } from 'vitest';
import type { Exchange, Match } from './types';
import {
  DEFAULT_MATCH_FORMAT_CONFIG,
  computeAfterblowDeltas,
  computeMatchFormatScore,
  displayClockMs,
  evaluateRound,
  getEffectiveBestOf,
  getEffectiveMatchTimeLimitSeconds,
  getEffectiveMaxDoubles,
  isMedalMatchLabel,
  getPointCapWinnerRegistrationId,
  isSoftClockLocked,
  MatchFormatConfigSchema,
  normalizeMatchFormatConfig,
  pointCapWinnerColor,
  roundWinTarget,
} from './match-format';

const BASE_MATCH: Match = {
  id: 'm1',
  redRegistrationId: 'reg-red',
  blueRegistrationId: 'reg-blue',
  rulesetCode: 'TF_v1',
  rulesetVersion: '1.0.0',
  status: 'running',
};

function makeExchange(overrides: Partial<Exchange>): Exchange {
  return {
    id: overrides.id ?? 'ex-1',
    clientUuid: overrides.clientUuid ?? 'uuid-1',
    matchId: 'm1',
    sequence: overrides.sequence ?? 1,
    type: 'clean',
    occurredAt: new Date().toISOString(),
    firstStrikerColor: 'red',
    firstStrikeValue: 1,
    afterblowValue: null,
    noExchangeReason: null,
    voided: false,
    ...overrides,
  };
}

describe('match format config', () => {
  it('exposes federal-rulebook defaults (pointCap=10, 90s time limits, 5s soft-clock, maxDoubleHits=4)', () => {
    // These are the global baseline for any ruleset that doesn't override
    // its match-format blob. Bumping these is a deliberate behavior change
    // requested by the operator — every fresh tournament inherits them.
    // Spelled out so a change still has to be deliberate.
    expect(DEFAULT_MATCH_FORMAT_CONFIG).toEqual({
      pointCap: 10,
      scoringDirection: 'normal',
      timerMode: 'countdown',
      timeLimitsSeconds: { pool: 90, bracket: 90, finals: 90 },
      softClockLimitSeconds: 5,
      maxDoubleHits: 4,
      maxDoubleHitOutcome: 'double_loss_zero_scores',
      bestOf: { pool: 1, bracket: 1, finals: 1 },
    });
  });

  it('parses an empty config to exactly the shared default', () => {
    // The default is a plain literal in @myclash/types, which the scoring pad
    // can reach and this package cannot be (zod sits on the path). The literal
    // is therefore the owner, and this is the check that the schema's own
    // defaults still PRODUCE it.
    //
    // They had drifted once, in the other direction: the client copy said
    // pointCap 5 / 180s / softClock 0 / maxDoubleHits null while the schema
    // said 10 / 90s / 5 / 4, and nothing caught it because no package could see
    // both. `TFv1DefaultConfig` seeds what this parse produces, so a drift here
    // hands a referee a clock the engine never agreed to.
    expect(MatchFormatConfigSchema.parse({})).toEqual(DEFAULT_MATCH_FORMAT_CONFIG);
  });

  it('normalizes legacy TF_v1 matchFormat config into shared match format', () => {
    const config = normalizeMatchFormatConfig({
      firstToPoints: 7,
      timeLimitSeconds: 120,
      maxDoubles: 4,
    });

    expect(config.pointCap).toBe(7);
    expect(config.timeLimitsSeconds.pool).toBe(120);
    expect(config.timeLimitsSeconds.bracket).toBe(120);
    expect(config.timeLimitsSeconds.finals).toBe(120);
    expect(config.maxDoubleHits).toBe(4);
  });

  it('computes normal first-to-cap scores from exchange points', () => {
    const score = computeMatchFormatScore(
      BASE_MATCH,
      [makeExchange({ firstStrikerColor: 'red', firstStrikeValue: 2 })],
      { ...DEFAULT_MATCH_FORMAT_CONFIG, pointCap: 5, scoringDirection: 'normal' },
    );

    expect(score.redScore).toBe(2);
    expect(score.blueScore).toBe(0);
  });

  it('computes reverse scoring as depletion where reaching zero loses', () => {
    const score = computeMatchFormatScore(
      BASE_MATCH,
      [
        makeExchange({ id: 'e1', sequence: 1, firstStrikerColor: 'red', firstStrikeValue: 2 }),
        makeExchange({ id: 'e2', sequence: 2, firstStrikerColor: 'red', firstStrikeValue: 2 }),
        makeExchange({ id: 'e3', sequence: 3, firstStrikerColor: 'red', firstStrikeValue: 1 }),
      ],
      { ...DEFAULT_MATCH_FORMAT_CONFIG, pointCap: 5, scoringDirection: 'reverse_zero_loses' },
    );

    expect(score.redScore).toBe(5);
    expect(score.blueScore).toBe(0);
  });

  it('resets a POOL match to zero when the configured double-hit limit is reached', () => {
    // Max-doubles "double loss" is a pool-only rule, so the match must be a pool
    // match for the limit to bite. A scoring hit is included to prove the reset.
    const score = computeMatchFormatScore(
      { ...BASE_MATCH, phaseType: 'pool' },
      [
        makeExchange({ id: 'e0', sequence: 1, firstStrikerColor: 'red', firstStrikeValue: 2 }),
        makeExchange({ id: 'e1', sequence: 2, type: 'double', firstStrikerColor: null }),
        makeExchange({ id: 'e2', sequence: 3, type: 'double', firstStrikerColor: null }),
      ],
      { ...DEFAULT_MATCH_FORMAT_CONFIG, maxDoubleHits: 2 },
    );

    expect(score.redScore).toBe(0);
    expect(score.blueScore).toBe(0);
    expect(score.doubles).toBe(2);
  });

  it('does NOT reset bracket/finals on max-doubles (pool-only rule)', () => {
    // Same exchanges in a bracket match keep their score — bracket & finals must
    // always resolve to a winner, so they never end on max-doubles.
    const exchanges = [
      makeExchange({ id: 'e0', sequence: 1, firstStrikerColor: 'red', firstStrikeValue: 2 }),
      makeExchange({ id: 'e1', sequence: 2, type: 'double', firstStrikerColor: null }),
      makeExchange({ id: 'e2', sequence: 3, type: 'double', firstStrikerColor: null }),
    ];
    const cfg = { ...DEFAULT_MATCH_FORMAT_CONFIG, maxDoubleHits: 2 };

    const quarterFinal: Match = {
      ...BASE_MATCH,
      phaseType: 'single_elim',
      matchNumberLabel: 'QF1',
    };
    const bracket = computeMatchFormatScore(quarterFinal, exchanges, cfg);
    expect(bracket.redScore).toBe(2);
    expect(bracket.doubles).toBe(2);

    const medalByLabelOnly: Match = { ...BASE_MATCH, matchNumberLabel: 'F' };
    expect(getEffectiveMaxDoubles({ ...BASE_MATCH, phaseType: 'pool' }, cfg)).toBe(2);
    expect(getEffectiveMaxDoubles({ ...BASE_MATCH, phaseType: 'single_elim' }, cfg)).toBeNull();
    // A medal LABEL alone does not make it a pool: only phaseType is read.
    expect(getEffectiveMaxDoubles(medalByLabelOnly, cfg)).toBeNull();
  });

  it('uses pool, bracket, and medal-match final time limits', () => {
    const config = {
      ...DEFAULT_MATCH_FORMAT_CONFIG,
      timeLimitsSeconds: { pool: 90, bracket: 120, finals: 180 },
    };

    expect(getEffectiveMatchTimeLimitSeconds({ ...BASE_MATCH, phaseType: 'pool' }, config)).toBe(
      90,
    );
    expect(
      getEffectiveMatchTimeLimitSeconds(
        { ...BASE_MATCH, phaseType: 'single_elim', matchNumberLabel: 'QF1' },
        config,
      ),
    ).toBe(120);
    expect(
      getEffectiveMatchTimeLimitSeconds(
        { ...BASE_MATCH, phaseType: 'single_elim', matchNumberLabel: '3rd' },
        config,
      ),
    ).toBe(180);
  });

  it.each(['F', 'final', ' Gold ', 'GOLD MEDAL MATCH', '3rd', 'Bronze', 'BRONZE MEDAL MATCH'])(
    'reads %s as a medal match',
    (label) => expect(isMedalMatchLabel(label)).toBe(true),
  );

  it.each([null, undefined, '', 'SF', 'QF-M1', 'FINALE'])('does not read %s as one', (label) =>
    expect(isMedalMatchLabel(label)).toBe(false),
  );

  it('detects soft clock lockout for stopped countdown clocks under the configured limit', () => {
    const config = {
      ...DEFAULT_MATCH_FORMAT_CONFIG,
      timerMode: 'countdown' as const,
      timeLimitsSeconds: { pool: 180, bracket: 180, finals: 180 },
      softClockLimitSeconds: 5,
    };

    expect(isSoftClockLocked({ ...BASE_MATCH, phaseType: 'pool' }, 176_000, false, config)).toBe(
      true,
    );
    expect(isSoftClockLocked({ ...BASE_MATCH, phaseType: 'pool' }, 176_000, true, config)).toBe(
      false,
    );
    expect(displayClockMs(176_000, config, 'pool', null)).toBe(4_000);
  });

  it('nets afterblows per mode — full awards both, deductive subtracts from the attacker', () => {
    // A "2-1" afterblow: red strikes first (raw 2), blue lands the afterblow (raw 1).
    const ex = [
      makeExchange({
        type: 'afterblow',
        firstStrikerColor: 'red',
        firstStrikeValue: 2,
        afterblowValue: 1,
      }),
    ];
    const cfg = { ...DEFAULT_MATCH_FORMAT_CONFIG, pointCap: 5 };

    // Default (full): both keep their points.
    const full = computeMatchFormatScore(BASE_MATCH, ex, cfg);
    expect(full.redScore).toBe(2);
    expect(full.blueScore).toBe(1);

    // Deductive: attacker nets max(0, 2 - 1) = 1, defender 0.
    const deductive = computeMatchFormatScore(BASE_MATCH, ex, cfg, 'deductive');
    expect(deductive.redScore).toBe(1);
    expect(deductive.blueScore).toBe(0);

    // A "1-1" afterblow cancels the attacker entirely in deductive mode.
    const evenAfterblow = [
      makeExchange({
        type: 'afterblow',
        firstStrikerColor: 'blue',
        firstStrikeValue: 1,
        afterblowValue: 1,
      }),
    ];
    const evenDeductive = computeMatchFormatScore(BASE_MATCH, evenAfterblow, cfg, 'deductive');
    expect(evenDeductive.redScore).toBe(0);
    expect(evenDeductive.blueScore).toBe(0);
  });

  it('computeAfterblowDeltas: deductive clamps at zero, full keeps both', () => {
    expect(computeAfterblowDeltas('full', 2, 1)).toEqual({ attackerDelta: 2, defenderDelta: 1 });
    expect(computeAfterblowDeltas('deductive', 2, 1)).toEqual({
      attackerDelta: 1,
      defenderDelta: 0,
    });
    expect(computeAfterblowDeltas('deductive', 1, 2)).toEqual({
      attackerDelta: 0,
      defenderDelta: 0,
    });
  });

  it('resolves point-cap winners for normal and reverse scoring', () => {
    expect(
      getPointCapWinnerRegistrationId(
        BASE_MATCH,
        { redScore: 5, blueScore: 3 },
        {
          ...DEFAULT_MATCH_FORMAT_CONFIG,
          pointCap: 5,
          scoringDirection: 'normal',
        },
      ),
    ).toBe('reg-red');

    expect(
      getPointCapWinnerRegistrationId(
        BASE_MATCH,
        { redScore: 2, blueScore: 0 },
        {
          ...DEFAULT_MATCH_FORMAT_CONFIG,
          pointCap: 5,
          scoringDirection: 'reverse_zero_loses',
        },
      ),
    ).toBe('reg-red');
  });
});

describe('best-of rounds', () => {
  it('defaults bestOf to a single round in every phase', () => {
    expect(DEFAULT_MATCH_FORMAT_CONFIG.bestOf).toEqual({ pool: 1, bracket: 1, finals: 1 });
  });

  it('dispatches effective bestOf by phase like the time limits', () => {
    const config = {
      ...DEFAULT_MATCH_FORMAT_CONFIG,
      bestOf: { pool: 1, bracket: 3, finals: 5 },
    };
    expect(getEffectiveBestOf({ ...BASE_MATCH, phaseType: 'pool' }, config)).toBe(1);
    expect(
      getEffectiveBestOf(
        { ...BASE_MATCH, phaseType: 'single_elim', matchNumberLabel: 'QF1' },
        config,
      ),
    ).toBe(3);
    expect(
      getEffectiveBestOf(
        { ...BASE_MATCH, phaseType: 'single_elim', matchNumberLabel: 'F' },
        config,
      ),
    ).toBe(5);
  });

  it('treats a missing bestOf (legacy config) as single round', () => {
    const legacy = { ...DEFAULT_MATCH_FORMAT_CONFIG } as Record<string, unknown>;
    delete legacy.bestOf;
    expect(getEffectiveBestOf({ ...BASE_MATCH, phaseType: 'pool' }, legacy as never)).toBe(1);
  });

  it('computes the round win target as ceil(N/2)', () => {
    expect(roundWinTarget(1)).toBe(1);
    expect(roundWinTarget(3)).toBe(2);
    expect(roundWinTarget(5)).toBe(3);
    expect(roundWinTarget(7)).toBe(4);
  });

  it('resolves the cap winner colour for normal and reverse scoring', () => {
    const normal = {
      ...DEFAULT_MATCH_FORMAT_CONFIG,
      pointCap: 5,
      scoringDirection: 'normal' as const,
    };
    expect(pointCapWinnerColor({ redScore: 5, blueScore: 3 }, normal)).toBe('red');
    expect(pointCapWinnerColor({ redScore: 2, blueScore: 5 }, normal)).toBe('blue');
    expect(pointCapWinnerColor({ redScore: 3, blueScore: 3 }, normal)).toBeNull();

    const reverse = {
      ...DEFAULT_MATCH_FORMAT_CONFIG,
      pointCap: 5,
      scoringDirection: 'reverse_zero_loses' as const,
    };
    expect(pointCapWinnerColor({ redScore: 0, blueScore: 2 }, reverse)).toBe('blue');
  });

  describe('evaluateRound', () => {
    const cfg = { ...DEFAULT_MATCH_FORMAT_CONFIG, pointCap: 3 };

    it('closes the round when a side reaches the point cap', () => {
      const ev = evaluateRound(
        { ...BASE_MATCH, phaseType: 'single_elim' },
        [
          makeExchange({ id: 'r1', sequence: 1, firstStrikerColor: 'red', firstStrikeValue: 2 }),
          makeExchange({ id: 'r2', sequence: 2, firstStrikerColor: 'red', firstStrikeValue: 1 }),
        ],
        cfg,
      );
      expect(ev.autoOver).toBe(true);
      expect(ev.winnerColor).toBe('red');
      expect(ev.endReason).toBe('first_to_points');
      expect(ev.score.redScore).toBe(3);
    });

    it('leaves the round open (operator must end on time) below the cap', () => {
      const ev = evaluateRound(
        { ...BASE_MATCH, phaseType: 'single_elim' },
        [makeExchange({ id: 'r1', sequence: 1, firstStrikerColor: 'blue', firstStrikeValue: 1 })],
        cfg,
      );
      expect(ev.autoOver).toBe(false);
      expect(ev.winnerColor).toBeNull();
      expect(ev.endReason).toBeNull();
      expect(ev.score.blueScore).toBe(1);
    });

    it('draws a POOL round on max-doubles (no round winner)', () => {
      const ev = evaluateRound(
        { ...BASE_MATCH, phaseType: 'pool' },
        [
          makeExchange({ id: 'd1', sequence: 1, type: 'double', firstStrikerColor: null }),
          makeExchange({ id: 'd2', sequence: 2, type: 'double', firstStrikerColor: null }),
        ],
        { ...cfg, maxDoubleHits: 2 },
      );
      expect(ev.autoOver).toBe(true);
      expect(ev.winnerColor).toBeNull();
      expect(ev.endReason).toBe('max_doubles');
    });

    it('does NOT auto-close a bracket round on max-doubles', () => {
      const ev = evaluateRound(
        { ...BASE_MATCH, phaseType: 'single_elim' },
        [
          makeExchange({ id: 'd1', sequence: 1, type: 'double', firstStrikerColor: null }),
          makeExchange({ id: 'd2', sequence: 2, type: 'double', firstStrikerColor: null }),
        ],
        { ...cfg, maxDoubleHits: 2 },
      );
      expect(ev.autoOver).toBe(false);
    });
  });
});
