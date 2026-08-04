/**
 * Turn a round token into the phase name an audience can read.
 *
 * The tokens (`SF`, `R16`, `PI`, `GF`, `LB2`, `S3`) are load-bearing — they
 * live in the match codes operators announce over the PA, and `parseBracketRound`,
 * `computeMatchKind` and `groupBracketPoolsBySection` all parse them back out.
 * So the abbreviations stay in the data and only the PRESENTATION widens: this
 * is the single place a token becomes "Semi Final".
 *
 * `roundTokenLabel` (in `@myclash/types`, which must stay locale-agnostic)
 * resolves the token to an i18n key + params; this pairs it with a translator.
 * Shared rather than inlined at each surface so the TV display, the scoring pad
 * and the bracket column headers cannot name the same round differently.
 *
 * Returns null for a token nobody recognises — callers omit the segment rather
 * than put a raw code on a projector.
 *
 * Pure: no React, no I/O.
 */

import { roundTokenLabel } from '@myclash/types';

/** The slice of a translator this util needs — apps pass their own. */
export type RoundTranslator = (key: string, values?: Record<string, string | number>) => string;

export function roundLabel(token: string | null | undefined, t: RoundTranslator): string | null {
  const descriptor = roundTokenLabel(token);
  if (!descriptor) return null;
  return t(descriptor.key, descriptor.params);
}

/**
 * Same expansion for a bracket COLUMN header, which names the whole round
 * rather than one bout — "Semi Finals", not "Semi Final". Only the three named
 * rounds inflect; "Round of 16" already reads as a group, so everything else
 * falls through to {@link roundLabel} rather than carry a duplicate key.
 */
const PLURAL_KEYS: Record<string, string> = {
  'common.round.final': 'common.round.columnFinals',
  'common.round.semiFinal': 'common.round.columnSemiFinals',
  'common.round.quarterFinal': 'common.round.columnQuarterFinals',
};

export function roundColumnLabel(
  token: string | null | undefined,
  t: RoundTranslator,
): string | null {
  const descriptor = roundTokenLabel(token);
  if (!descriptor) return null;
  const plural = PLURAL_KEYS[descriptor.key];
  return t(plural ?? descriptor.key, descriptor.params);
}
