/**
 * packages/rulesets/src/tf_v1_no_afterblow/index.ts
 *
 * TF_v1_no_afterblow — variant of TF_v1 without afterblow scoring.
 * Afterblow exchanges are treated as clean hits for the first striker only;
 * the afterblow value is ignored (pure first-hit ruleset).
 *
 * ARCHITECTURE.md §7.2: "TF_v1_no_afterblow — variant without afterblow
 * concept (pure first-hit)."
 */
import { z } from 'zod';
import type { Exchange, Match, Pool, Registration, Ruleset } from '../types';
import { TFv1ConfigSchema, TFv1DefaultConfig } from '../tf_v1/config';
import { computePoolStandings } from '../tf_v1/standings';
import { isMatchOver } from '../tf_v1/score';

// ── Score computation (no afterblow) ─────────────────────────────────────────

function computeMatchScoreNoAfterblow(
  match: Match,
  exchanges: Exchange[],
) {
  const active = exchanges.filter((e) => !e.voided);

  let redScore = 0;
  let blueScore = 0;
  let redTargetPoints = 0;
  let blueTargetPoints = 0;
  let redTimesHit = 0;
  let blueTimesHit = 0;
  let doubles = 0;

  for (const ex of active) {
    switch (ex.type) {
      case 'clean':
        if (ex.firstStrikerColor === 'red') {
          redScore += ex.firstStrikeValue ?? 0;
          redTargetPoints += ex.firstStrikeValue ?? 0;
          blueTimesHit += 1;
        } else if (ex.firstStrikerColor === 'blue') {
          blueScore += ex.firstStrikeValue ?? 0;
          blueTargetPoints += ex.firstStrikeValue ?? 0;
          redTimesHit += 1;
        }
        break;

      case 'afterblow':
        // No afterblow scoring — treat as clean hit for first striker only
        if (ex.firstStrikerColor === 'red') {
          redScore += ex.firstStrikeValue ?? 0;
          redTargetPoints += ex.firstStrikeValue ?? 0;
          blueTimesHit += 1;
          // afterblow_value is IGNORED
        } else if (ex.firstStrikerColor === 'blue') {
          blueScore += ex.firstStrikeValue ?? 0;
          blueTargetPoints += ex.firstStrikeValue ?? 0;
          redTimesHit += 1;
          // afterblow_value is IGNORED
        }
        break;

      case 'double':
        doubles += 1;
        break;

      case 'no_exchange':
        break;
    }
  }

  return {
    redScore,
    blueScore,
    redWins: 0,
    blueWins: 0,
    redTargetPoints,
    blueTargetPoints,
    redTimesHit,
    blueTimesHit,
    doubles,
  };
}

// ── Ruleset ───────────────────────────────────────────────────────────────────

export const TF_v1_no_afterblow: Ruleset = {
  code: 'TF_v1_no_afterblow',
  version: '1.0.0',
  displayName: 'TF v1 — Sans Afterblow (Première touche uniquement)',
  configSchema: TFv1ConfigSchema,

  computeMatchScore(match: Match, exchanges: Exchange[], _config: unknown) {
    return computeMatchScoreNoAfterblow(match, exchanges);
  },

  isMatchOver(match: Match, exchanges: Exchange[], clockMs: number, config: unknown) {
    const cfg = TFv1ConfigSchema.parse(config ?? TFv1DefaultConfig);
    return isMatchOver(match, exchanges, clockMs, cfg);
  },

  computePoolStandings(
    pool: Pool,
    matches: Match[],
    registrations: Registration[],
    config: unknown,
  ) {
    // Standings use the same TF_v1 algorithm (score formula unchanged)
    // but match scores are computed without afterblow
    const cfg = TFv1ConfigSchema.parse(config ?? TFv1DefaultConfig);
    return computePoolStandings(pool, matches, registrations, cfg);
  },
};
