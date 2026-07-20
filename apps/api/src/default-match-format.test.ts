import { describe, it, expect } from 'vitest';
import { DEFAULT_MATCH_FORMAT_CONFIG as TYPES_DEFAULT } from '@myclash/types';
import { DEFAULT_MATCH_FORMAT_CONFIG as ENGINE_DEFAULT } from '@myclash/rulesets';

/**
 * The default match format is defined TWICE, on purpose:
 *
 *  - `@myclash/rulesets` (match-format.ts) — `MatchFormatConfigSchema.parse({})`,
 *    the canonical values, and what TFv1DefaultConfig seeds into tournaments.
 *  - `@myclash/types` (scoring-config.ts) — a plain constant the browser clients
 *    fall back to when a tournament carries no config.
 *
 * The duplication exists because the engine is deliberately dependency-free
 * (zod only), so `@myclash/types` must not import it — that edge would drag the
 * engine into every app's Docker build via `@myclash/ui`.
 *
 * They had drifted: the client copy said pointCap 5 / 180s / softClock 0 /
 * maxDoubleHits null while the engine said 10 / 90s / 5 / 4. Nothing caught it,
 * because no test could see both at once. This one can — apps/api depends on
 * both packages — so drift fails here instead of showing a referee a clock the
 * engine never agreed to.
 */
describe('DEFAULT_MATCH_FORMAT_CONFIG', () => {
  it('is identical in @myclash/types and @myclash/rulesets', () => {
    expect(TYPES_DEFAULT).toEqual(ENGINE_DEFAULT);
  });

  it('pins the canonical values', () => {
    // Spelled out so a change to BOTH copies still has to be deliberate.
    expect(ENGINE_DEFAULT).toMatchObject({
      pointCap: 10,
      scoringDirection: 'normal',
      timerMode: 'countdown',
      timeLimitsSeconds: { pool: 90, bracket: 90, finals: 90 },
      softClockLimitSeconds: 5,
      maxDoubleHits: 4,
      bestOf: { pool: 1, bracket: 1, finals: 1 },
    });
  });
});
