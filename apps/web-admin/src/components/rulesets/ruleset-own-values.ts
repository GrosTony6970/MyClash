/**
 * A ruleset's OWN values against the engine's, for the ruleset editor: the ONE owner of what a
 * field shows, whether it is "modified", and what an edit or a Reset leaves stored (operator
 * rulings 59, 60, 134, 136-138, 2026-10-20/22).
 *
 * A ruleset stores only what its author set; a field it does not store follows the engine. So an
 * edit that types the engine's value back empties the field (ruling 137), Reset empties it
 * (ruling 60), and the badge shows when what the field SHOWS differs from the engine (ruling 134).
 * A stored leaf the engine refuses is shown as the engine's value, never thrown on.
 *
 * Pure: no React, no I/O.
 */
import {
  DEFAULT_MATCH_FORMAT_CONFIG,
  MatchFormatConfigSchema,
  TFv1ConfigSchema,
  TFv1DefaultConfig,
  type DoublePenaltySpec,
} from '@myclash/rulesets';

/** A ruleset's own match format as stored: any subset, keys the box does not show included. */
export type OwnMatchFormat = Record<string, unknown>;

export type PhaseLeaf = 'pool' | 'bracket' | 'finals';
/** The match format values the editor's box shows (the time limits are the three phases). */
export type MatchFormatLeaf =
  | 'pointCap'
  | 'timerMode'
  | 'scoringDirection'
  | 'softClockLimitSeconds'
  | 'maxDoubleHits'
  | PhaseLeaf;
export type LeafValue = number | string | null;

const PHASES: readonly string[] = ['pool', 'bracket', 'finals'];
const isPhase = (leaf: MatchFormatLeaf): leaf is PhaseLeaf => PHASES.includes(leaf);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function leafSchema(leaf: MatchFormatLeaf) {
  return isPhase(leaf)
    ? MatchFormatConfigSchema.shape.timeLimitsSeconds.unwrap().shape[leaf]
    : MatchFormatConfigSchema.shape[leaf];
}

/** The engine's value of `leaf`. */
export function engineLeaf(leaf: MatchFormatLeaf): LeafValue {
  return isPhase(leaf)
    ? DEFAULT_MATCH_FORMAT_CONFIG.timeLimitsSeconds[leaf]
    : DEFAULT_MATCH_FORMAT_CONFIG[leaf];
}

/** Whether the engine takes `value` for `leaf` (a time limit's null is "no limit"). */
export function acceptsLeaf(leaf: MatchFormatLeaf, value: unknown): boolean {
  return value !== undefined && leafSchema(leaf).safeParse(value).success;
}

function stored(own: OwnMatchFormat, leaf: MatchFormatLeaf): unknown {
  if (!isPhase(leaf)) return own[leaf];
  const phases = own['timeLimitsSeconds'];
  return isObject(phases) ? phases[leaf] : undefined;
}

/** What the field of `leaf` shows: the ruleset's own value when the engine takes it, else the engine's. */
export function shownLeaf(own: OwnMatchFormat, leaf: MatchFormatLeaf): LeafValue {
  const value = stored(own, leaf);
  return acceptsLeaf(leaf, value) ? (value as LeafValue) : engineLeaf(leaf);
}

export function differsFromEngine(own: OwnMatchFormat, leaf: MatchFormatLeaf): boolean {
  return shownLeaf(own, leaf) !== engineLeaf(leaf);
}

/** `own` without `leaf`: the field follows the engine. An emptied time-limits object goes too. */
export function withoutOwn(own: OwnMatchFormat, leaf: MatchFormatLeaf): OwnMatchFormat {
  const next = { ...own };
  if (!isPhase(leaf)) {
    delete next[leaf];
    return next;
  }
  const phases = isObject(own['timeLimitsSeconds']) ? { ...own['timeLimitsSeconds'] } : {};
  delete phases[leaf];
  if (Object.keys(phases).length > 0) next['timeLimitsSeconds'] = phases;
  else delete next['timeLimitsSeconds'];
  return next;
}

/** `own` with `leaf` set to `value`, or without it when that is the engine's value (ruling 137). */
export function withOwn(
  own: OwnMatchFormat,
  leaf: MatchFormatLeaf,
  value: LeafValue,
): OwnMatchFormat {
  if (value === engineLeaf(leaf)) return withoutOwn(own, leaf);
  if (!isPhase(leaf)) return { ...own, [leaf]: value };
  const phases = isObject(own['timeLimitsSeconds']) ? own['timeLimitsSeconds'] : {};
  return { ...own, timeLimitsSeconds: { ...phases, [leaf]: value } };
}

/** What a Save stores: null when the ruleset sets nothing of its own. */
export function storedOwn(own: OwnMatchFormat): OwnMatchFormat | null {
  return Object.keys(own).length > 0 ? own : null;
}

// ── The TF_v1 dials (ruling 136) ─────────────────────────────────────────────

/** A TF_v1 ruleset's own win bonus and double penalty, each absent when it follows the engine. */
export interface OwnCoded {
  winBonus?: number;
  doublePenaltyFormula?: DoublePenaltySpec;
}
export type Dial = keyof OwnCoded;

const ENGINE_DIALS: Required<OwnCoded> = {
  winBonus: TFv1DefaultConfig.winBonus,
  doublePenaltyFormula: TFv1DefaultConfig.doublePenaltyFormula,
};

/** "No double-hit penalty" on a TF_v1 ruleset: the engine's '0' formula (ruling 138). */
export const NO_DOUBLE_PENALTY: DoublePenaltySpec = '0';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function engineDial<K extends Dial>(dial: K): Required<OwnCoded>[K] {
  return ENGINE_DIALS[dial];
}

export function shownDial<K extends Dial>(own: OwnCoded, dial: K): Required<OwnCoded>[K] {
  return (own[dial] ?? ENGINE_DIALS[dial]) as Required<OwnCoded>[K];
}

export function dialDiffers(own: OwnCoded, dial: Dial): boolean {
  return !same(shownDial(own, dial), ENGINE_DIALS[dial]);
}

export function withoutDial(own: OwnCoded, dial: Dial): OwnCoded {
  const next = { ...own };
  delete next[dial];
  return next;
}

export function withDial<K extends Dial>(
  own: OwnCoded,
  dial: K,
  value: Required<OwnCoded>[K],
): OwnCoded {
  return same(value, ENGINE_DIALS[dial]) ? withoutDial(own, dial) : { ...own, [dial]: value };
}

/** Whether the engine takes `value` as a win bonus. */
export function acceptsWinBonus(value: number | null): boolean {
  return value !== null && TFv1ConfigSchema.safeParse({ winBonus: value }).success;
}
