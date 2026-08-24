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
  isPointCapReached,
  normalizeMatchFormatConfig,
} from '../match-format';
import type {
  AfterblowMode,
  Exchange,
  Match,
  MatchEndDecision,
  MatchScore,
  Ruleset,
  ScoredMatch,
  ScorePoolFightersInput,
  StandingsColumn,
  RankingRule,
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
  match: Pick<Match, 'phaseType'>,
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

/**
 * Reads the score the caller already holds. The `time_limit` branch went with
 * the `clockMs` parameter — the only production call passed a literal 0, so it
 * could never fire; `ClockService` ends a bout on time.
 */
function matchOver(score: MatchScore, config: GenericPointsCapConfig): MatchEndDecision {
  if (isPointCapReached(score, config.matchFormat)) {
    return { isOver: true, reason: 'first_to_points' };
  }
  return { isOver: false, reason: null };
}

// ── Pool scoring ──────────────────────────────────────────────────────────────

/**
 * No algorithm score: rank by wins, then by points differential. The 1000
 * multiplier is what keeps a win ahead of any realistic differential, so the
 * two orderings compose into one number.
 *
 * Points for and against are re-derived from each bout's exchanges rather than
 * read off the stored match score, because this ruleset remaps every hit to its
 * configured `pointValues.hit` first.
 */
function scoreFighters({
  registrationIds,
  completedMatches,
  config,
}: {
  registrationIds: string[];
  completedMatches: ScoredMatch[];
  config: GenericPointsCapConfig;
}): Map<string, number> {
  const stats = new Map(registrationIds.map((id) => [id, { wins: 0, ptsFor: 0, ptsAgainst: 0 }]));

  for (const match of completedMatches) {
    // A finished bout carries no phase, so `getEffectiveMaxDoubles` inside the
    // scorer returns null and a max-doubles bout is NOT zeroed here. That is
    // what this path already did — it used to cast a PostgREST row into a
    // `Match`, and the row has no `phaseType` either — so the omission was
    // real, silent and untyped. Stated rather than accidental now. Whether
    // pool standings SHOULD zero a max-doubles bout is a rules question, and
    // changing it is not this refactor's to make.
    const score = computeScore({ phaseType: undefined }, match.exchanges, config);
    const red = stats.get(match.redRegistrationId);
    const blue = stats.get(match.blueRegistrationId);

    if (red) {
      red.wins += match.winnerRegistrationId === match.redRegistrationId ? 1 : 0;
      red.ptsFor += score.redScore;
      red.ptsAgainst += score.blueScore;
    }
    if (blue) {
      blue.wins += match.winnerRegistrationId === match.blueRegistrationId ? 1 : 0;
      blue.ptsFor += score.blueScore;
      blue.ptsAgainst += score.redScore;
    }
  }

  return new Map([...stats].map(([id, s]) => [id, s.wins * 1000 + (s.ptsFor - s.ptsAgainst)]));
}

// ── Standings / ranking declarations ─────────────────────────────────────────

const GENERIC_STANDINGS_COLUMNS: StandingsColumn[] = [
  { key: 'W', label: 'Wins', type: 'number', sortDesc: true },
  { key: 'L', label: 'Losses', type: 'number', sortDesc: false },
  { key: 'D', label: 'Draws', type: 'number', sortDesc: true },
  { key: 'ptsScored', label: 'Points scored', type: 'number', sortDesc: true },
  { key: 'ptsConceded', label: 'Points conceded', type: 'number', sortDesc: false },
  { key: 'diff', label: 'Differential', type: 'number', sortDesc: true },
];

const GENERIC_RANKING_CHAIN: RankingRule[] = [
  { key: 'W', direction: 'desc' },
  { key: 'diff', direction: 'desc' },
  { key: 'ptsScored', direction: 'desc' },
];

// ── Ruleset ───────────────────────────────────────────────────────────────────

export const Generic_PointsCap: Ruleset = {
  code: 'Generic_PointsCap',
  version: '1.0.0',
  displayName: 'Points Cap (Premier à N points)',

  // This ruleset has no afterblow concept — `metadata.hasAfterblow` is false —
  // so the mode is accepted and ignored rather than threaded on.
  computeMatchScore(
    match: Match,
    exchanges: Exchange[],
    _afterblowMode: AfterblowMode,
    config: unknown,
  ) {
    return computeScore(match, exchanges, normalizeGenericPointsCapConfig(config));
  },

  isMatchOver(_match: Match, score: MatchScore, config: unknown) {
    return matchOver(score, normalizeGenericPointsCapConfig(config));
  },

  scorePoolFighters({ registrationIds, completedMatches, config }: ScorePoolFightersInput) {
    return scoreFighters({
      registrationIds,
      completedMatches,
      config: normalizeGenericPointsCapConfig(config),
    });
  },

  standingsColumns: GENERIC_STANDINGS_COLUMNS,
  rankingChain: GENERIC_RANKING_CHAIN,

  metadata: {
    hasAfterblow: false,
    defaultAfterblowMode: null,
    afterblowValuation: null,
    afterblowFixedValue: null,
    winBonus: null,
    doublePenaltyFormula: null,
    // A single undifferentiated hit — the case the deepTarget/shallowTarget
    // pair could not express, and the reason `targets` is a list.
    targets: [{ name: 'Hit', value: 1 }],
    deepTargetDefault: null,
    shallowTargetDefault: null,
  },
};
