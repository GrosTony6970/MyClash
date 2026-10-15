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

/** A phase as one word, for a bout that holds no round of its own: one made by hand. */
const PHASE_KEYS: Record<string, string> = {
  pool: 'common.round.phasePool',
  swiss: 'common.round.phaseSwiss',
  single_elim: 'common.round.phaseBracket',
  double_elim: 'common.round.phaseBracket',
};

export interface BoutNameParts {
  /** `matches.match_number_label`. */
  label?: string | null;
  tournamentName?: string | null;
  roundToken?: string | null;
  poolName?: string | null;
  phaseType?: string | null;
}

/**
 * A bout as a person reads it: its number, or, when it has none, its Tournament and its round
 * ("Longsword Open · Quarter Final", "Longsword Open · Pool 2"). Never its id (ruled 2026-10-15).
 */
export function boutName(parts: BoutNameParts, t: RoundTranslator): string {
  const label = parts.label?.trim();
  if (label) return label;
  const phaseKey = parts.phaseType ? PHASE_KEYS[parts.phaseType] : undefined;
  const round =
    roundLabel(parts.roundToken, t) || parts.poolName?.trim() || (phaseKey ? t(phaseKey) : null);
  return [parts.tournamentName?.trim(), round].filter(Boolean).join(' · ');
}

export function roundColumnLabel(
  token: string | null | undefined,
  t: RoundTranslator,
): string | null {
  const descriptor = roundTokenLabel(token);
  if (!descriptor) return null;
  const plural = PLURAL_KEYS[descriptor.key];
  return t(plural ?? descriptor.key, descriptor.params);
}
