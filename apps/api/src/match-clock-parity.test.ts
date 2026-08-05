import { describe, expect, it } from 'vitest';
import {
  effectiveTimeLimitSeconds,
  isMedalMatchLabel,
  displayClockMs,
  type MatchFormatConfig,
  type PhaseType,
} from '@myclash/types';
import {
  computeMatchClockMs,
  getEffectiveMatchTimeLimitSeconds,
  isMedalMatch,
  type Match,
} from '@myclash/rulesets';

/**
 * The phase time-limit dispatch is defined TWICE, on purpose — same reason as
 * `default-match-format.test.ts`:
 *
 *  - `@myclash/rulesets` (match-format.ts) — `getEffectiveMatchTimeLimitSeconds`
 *    / `computeMatchClockMs`, the rule that actually ENDS the bout.
 *  - `@myclash/types` (match-clock.ts) — `effectiveTimeLimitSeconds` /
 *    `displayClockMs`, what every scoreboard RENDERS.
 *
 * The engine is deliberately dependency-free (zod only), so `@myclash/types`
 * must not import it — that edge would drag the engine into every app's Docker
 * build via `@myclash/ui`.
 *
 * Drift here does not throw. It shows a referee a clock reading 01:30 while the
 * engine is counting to 02:00, on the one surface nobody can cross-check
 * mid-bout. `apps/api` depends on both packages, so it is the only place the
 * two can be compared at all.
 */

const CONFIG: MatchFormatConfig = {
  pointCap: 10,
  scoringDirection: 'normal',
  timerMode: 'countdown',
  // Distinct per phase so a wrong dispatch cannot accidentally agree.
  timeLimitsSeconds: { pool: 90, swiss: 120, bracket: 180, finals: 240 },
  softClockLimitSeconds: 5,
  maxDoubleHits: 4,
  maxDoubleHitOutcome: 'double_loss_zero_scores',
  bestOf: { pool: 1, bracket: 1, finals: 1 },
};

/** A config persisted before the Swiss format existed: no `swiss` key. */
const PRE_SWISS: MatchFormatConfig = {
  ...CONFIG,
  timeLimitsSeconds: { pool: 90, bracket: 180, finals: 240 },
};

const PHASES: Array<PhaseType | undefined> = [
  'pool',
  'swiss',
  'single_elim',
  'double_elim',
  undefined,
];
const LABELS = [null, 'P1-M3', 'S2-M1', 'QF-M1', 'SF', 'F', 'BRONZE', '3rd', 'Gold Medal Match'];

function engineMatch(phaseType: PhaseType | undefined, matchNumberLabel: string | null): Match {
  return {
    id: 'm1',
    redRegistrationId: 'r',
    blueRegistrationId: 'b',
    rulesetCode: 'TF_v1',
    rulesetVersion: '1.0.0',
    status: 'running',
    phaseType,
    matchNumberLabel,
  };
}

describe('match clock dispatch parity (@myclash/types ↔ @myclash/rulesets)', () => {
  it('resolves the same time limit for every phase × label', () => {
    for (const config of [CONFIG, PRE_SWISS]) {
      for (const phaseType of PHASES) {
        for (const label of LABELS) {
          expect(effectiveTimeLimitSeconds(config, phaseType, label)).toBe(
            getEffectiveMatchTimeLimitSeconds(engineMatch(phaseType, label), config),
          );
        }
      }
    }
  });

  it('identifies the same medal matches', () => {
    for (const label of [...LABELS, '', 'FINALE', 'gold']) {
      expect(isMedalMatchLabel(label)).toBe(isMedalMatch(engineMatch(undefined, label)));
    }
  });

  it('renders the same numeral in both timer modes', () => {
    for (const timerMode of ['countdown', 'countup'] as const) {
      const config = { ...CONFIG, timerMode };
      for (const phaseType of PHASES) {
        for (const label of LABELS) {
          for (const elapsedMs of [0, 1_000, 89_999, 90_000, 240_001]) {
            expect(displayClockMs(elapsedMs, config, phaseType, label)).toBe(
              computeMatchClockMs(engineMatch(phaseType, label), elapsedMs, config),
            );
          }
        }
      }
    }
  });
});
