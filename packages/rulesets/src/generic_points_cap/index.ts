/**
 * packages/rulesets/src/generic_points_cap/index.ts
 *
 * Generic_PointsCap — first-to-N points, no algorithm score.
 * Simple pool play: whoever reaches the point cap first wins.
 * Pool standings are ranked by wins, then points scored, then points received.
 *
 * ARCHITECTURE.md §7.2: "Generic_PointsCap — first-to-N points, no algorithm
 * score (for clubs that just want simple pool play)."
 */
import { z } from 'zod';
import {
  DEFAULT_MATCH_FORMAT_CONFIG,
  MatchFormatConfigSchema,
  computeMatchFormatScore,
  getEffectiveMatchTimeLimitSeconds,
  isPointCapReached,
  normalizeMatchFormatConfig,
} from '../match-format';
import type {
  Exchange,
  Match,
  MatchEndDecision,
  MatchScore,
  Pool,
  PoolStandingRow,
  Registration,
  Ruleset,
} from '../types';

// ── Config ────────────────────────────────────────────────────────────────────

export const GenericPointsCapConfigSchema = z.object({
  matchFormat: z
    .preprocess((value) => normalizeMatchFormatConfig(value), MatchFormatConfigSchema)
    .default(DEFAULT_MATCH_FORMAT_CONFIG),
  pointsCap: z.number().int().positive().optional(),
  timeLimitSeconds: z.number().int().positive().nullable().optional(),
  pointValues: z
    .object({
      hit: z.number().int().positive().default(1),
    })
    .default({ hit: 1 }),
});

export type GenericPointsCapConfig = z.infer<typeof GenericPointsCapConfigSchema>;
export const GenericPointsCapDefaultConfig: GenericPointsCapConfig =
  GenericPointsCapConfigSchema.parse({});

function normalizeGenericPointsCapConfig(config: unknown): GenericPointsCapConfig {
  const parsed = GenericPointsCapConfigSchema.parse(config ?? GenericPointsCapDefaultConfig);
  if (parsed.pointsCap !== undefined || parsed.timeLimitSeconds !== undefined) {
    return {
      ...parsed,
      matchFormat: normalizeMatchFormatConfig({
        ...parsed.matchFormat,
        pointCap: parsed.pointsCap ?? parsed.matchFormat.pointCap,
        timeLimitsSeconds:
          parsed.timeLimitSeconds === undefined
            ? parsed.matchFormat.timeLimitsSeconds
            : {
                pool: parsed.timeLimitSeconds,
                bracket: parsed.timeLimitSeconds,
                finals: parsed.timeLimitSeconds,
              },
      }),
    };
  }
  return parsed;
}

// ── Score computation ─────────────────────────────────────────────────────────

function computeScore(
  match: Match,
  exchanges: Exchange[],
  config: GenericPointsCapConfig,
): MatchScore {
  const hitValue = config.pointValues.hit;
  return computeMatchFormatScore(
    match,
    exchanges.map((exchange) =>
      exchange.type === 'clean' || exchange.type === 'afterblow'
        ? {
            ...exchange,
            type: 'clean',
            firstStrikeValue: hitValue as 1 | 2,
            afterblowValue: null,
          }
        : exchange,
    ),
    config.matchFormat,
  );
}

// ── Match end ─────────────────────────────────────────────────────────────────

function matchOver(
  match: Match,
  exchanges: Exchange[],
  clockMs: number,
  config: GenericPointsCapConfig,
): MatchEndDecision {
  const score = computeScore(match, exchanges, config);

  if (isPointCapReached(score, config.matchFormat)) {
    return { isOver: true, reason: 'first_to_points' };
  }

  const timeLimitSeconds = getEffectiveMatchTimeLimitSeconds(match, config.matchFormat);
  if (timeLimitSeconds !== null && clockMs >= timeLimitSeconds * 1000) {
    return { isOver: true, reason: 'time_limit' };
  }

  return { isOver: false, reason: null };
}

// ── Pool standings ────────────────────────────────────────────────────────────

function standings(
  _pool: Pool,
  matches: Match[],
  registrations: Registration[],
  config: GenericPointsCapConfig,
): PoolStandingRow[] {
  const stats = new Map<string, { wins: number; ptsFor: number; ptsAgainst: number }>();
  for (const reg of registrations) {
    stats.set(reg.id, { wins: 0, ptsFor: 0, ptsAgainst: 0 });
  }

  for (const match of matches) {
    if (match.status !== 'completed') continue;
    const matchExchanges = (match as Match & { exchanges?: Exchange[] }).exchanges ?? [];
    const score = computeScore(match, matchExchanges, config);
    const winnerId = (match as Match & { winnerRegistrationId?: string }).winnerRegistrationId;

    const red = stats.get(match.redRegistrationId);
    const blue = stats.get(match.blueRegistrationId);

    if (red) {
      red.wins += winnerId === match.redRegistrationId ? 1 : 0;
      red.ptsFor += score.redScore;
      red.ptsAgainst += score.blueScore;
    }
    if (blue) {
      blue.wins += winnerId === match.blueRegistrationId ? 1 : 0;
      blue.ptsFor += score.blueScore;
      blue.ptsAgainst += score.redScore;
    }
  }

  const rows = registrations.map((reg) => {
    const s = stats.get(reg.id) ?? { wins: 0, ptsFor: 0, ptsAgainst: 0 };
    return {
      registrationId: reg.id,
      rank: 0,
      wins: s.wins,
      targetPoints: s.ptsFor,
      timesHit: s.ptsAgainst,
      doubles: 0,
      // No algorithm score — rank by wins, then pts differential
      score: s.wins * 1000 + (s.ptsFor - s.ptsAgainst),
      seed: reg.seed ?? reg.bibNumber ?? null,
    };
  });

  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const seedA = a.seed ?? Infinity;
    const seedB = b.seed ?? Infinity;
    return seedA - seedB;
  });

  rows.forEach((row, idx) => {
    row.rank = idx + 1;
  });

  return rows.map(({ seed: _seed, ...row }) => row);
}

// ── Ruleset ───────────────────────────────────────────────────────────────────

export const Generic_PointsCap: Ruleset = {
  code: 'Generic_PointsCap',
  version: '1.0.0',
  displayName: 'Points Cap (Premier à N points)',
  configSchema: GenericPointsCapConfigSchema,

  computeMatchScore(match: Match, exchanges: Exchange[], config: unknown) {
    const cfg = normalizeGenericPointsCapConfig(config);
    return computeScore(match, exchanges, cfg);
  },

  isMatchOver(match: Match, exchanges: Exchange[], clockMs: number, config: unknown) {
    const cfg = normalizeGenericPointsCapConfig(config);
    return matchOver(match, exchanges, clockMs, cfg);
  },

  computePoolStandings(
    pool: Pool,
    matches: Match[],
    registrations: Registration[],
    config: unknown,
  ) {
    const cfg = normalizeGenericPointsCapConfig(config);
    return standings(pool, matches, registrations, cfg);
  },
};
