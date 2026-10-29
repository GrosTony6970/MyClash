/**
 * What changed in a Tournament's scoring rules, and which of those changes the rules lock refuses
 * (the audited settings change, its plan's revisions 7-11).
 *
 * The diff walks the scoring canonical (`canonicalizeScoringBehaviour`), the same object the
 * content hash fingerprints, so a change the hash sees is a change the diff names. It names it by
 * the fixed path list of `@myclash/types` (`SCORING_CHANGE_PATHS`), and a leaf of the canonical that
 * is not on that list still yields an `unknown` entry: a new canonical field is never a change the
 * lock cannot see.
 *
 * Pure. `content-hash.ts` stays dependency-free; this module reads the path list and the default
 * buttons from `@myclash/types`.
 */
import {
  SCORING_CHANGE_PATHS,
  formatPhaseOfPath,
  scoringButtonsOf,
  type FormatPhase,
  type RulesChange,
} from '@myclash/types';
import { stableStringify } from './content-hash';

/** The scoring part of a Tournament's buttons: the points each one gives, nothing else. */
export interface ButtonValues {
  clean: Array<number | null>;
  afterblow: Array<[number | null, number | null]>;
}

/**
 * The points every scoring button gives, as two SORTED lists: a clean button's `value`, an
 * afterblow button's `[attackerPts, defenderPts]`. Hidden buttons count: the organiser may show
 * one again in the settings, and visibility is free (operator ruling "Button values": labels,
 * order and visibility are not scoring). The buttons are read as the pad scores them, by the one
 * rule of `scoringButtonsOf` (a list as stored, else the default list).
 *
 * The stored JSON is not validated here: a point that is not a finite number reads as null, so a
 * malformed button is a value that compares, never a throw or a NaN that sorts anywhere.
 */
export function buttonValuesOf(
  scoringConfig: Record<string, unknown> | null | undefined,
): ButtonValues {
  const { clean, afterblow } = scoringButtonsOf(scoringConfig?.['buttons']);
  return {
    clean: clean.map((button) => pointsOf(button, 'value')).sort(byPoints),
    afterblow: afterblow
      .map((button): [number | null, number | null] => [
        pointsOf(button, 'attackerPts'),
        pointsOf(button, 'defenderPts'),
      ])
      .sort((a, b) => byPoints(a[0], b[0]) || byPoints(a[1], b[1])),
  };
}

function pointsOf(button: unknown, key: string): number | null {
  const points = isPlainObject(button) ? button[key] : undefined;
  return typeof points === 'number' && Number.isFinite(points) ? points : null;
}

/** Numbers in order, then the nulls. */
function byPoints(a: number | null, b: number | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return a - b;
}

/** One side of a diff: its scoring canonical and its button values. */
export interface ScoringSide {
  canonical: Record<string, unknown>;
  buttons: ButtonValues;
}

/**
 * Every change between two sides, one entry per listed path, in `SCORING_CHANGE_PATHS` order; a list
 * or an object the path names is ONE entry. Then ONE `unknown` entry when any leaf the list does
 * not cover changed: its `before`/`after` map each such leaf's dotted path to its value.
 */
export function scoringDiff(before: ScoringSide, after: ScoringSide): RulesChange[] {
  const changes: RulesChange[] = [];
  for (const path of SCORING_CHANGE_PATHS) {
    const pair = valuesAt(before, after, path);
    if (pair && differs(pair[0], pair[1])) {
      changes.push({ path, before: pair[0], after: pair[1] });
    }
  }
  const unknown = unlistedChange(before.canonical, after.canonical);
  if (unknown) changes.push(unknown);
  return changes;
}

/**
 * What has started in a Tournament: whether it runs (its Event running with bouts made, or its own
 * status `running`: the caller reads it), and the format phases a bout has started in.
 */
export interface RulesClock {
  running: boolean;
  startedFormatPhases: ReadonlySet<FormatPhase>;
}

/**
 * Whether the Tournament's own rules are locked: it runs, or ANY bout of it has started. The ONE
 * owner of "locked" for a Tournament key, a card pin and a forfeit rule; `lockedChanges` asks it.
 */
export function clockLocks(clock: RulesClock): boolean {
  return clock.running || clock.startedFormatPhases.size > 0;
}

/**
 * Every entry, with `locked` set. A swiss, bracket or finals key locks once a bout of that format
 * phase has started; every other path, a pool key included (a pool key is a Tournament key), locks
 * on `clockLocks` (operator rulings "Phase lock", "Offline clock").
 */
export function lockedChanges(changes: readonly RulesChange[], clock: RulesClock): RulesChange[] {
  const tournamentLocked = clockLocks(clock);
  return changes.map((change) => {
    const phase = formatPhaseOfPath(change.path);
    const locked =
      phase === null || phase === 'pool' ? tournamentLocked : clock.startedFormatPhases.has(phase);
    return { ...change, locked };
  });
}

function valuesAt(
  before: ScoringSide,
  after: ScoringSide,
  path: (typeof SCORING_CHANGE_PATHS)[number],
): [unknown, unknown] | null {
  if (path === 'buttons.clean' || path === 'buttons.afterblow') {
    const key = path === 'buttons.clean' ? 'clean' : 'afterblow';
    return [before.buttons[key], after.buttons[key]];
  }
  const segments = path.split('.');
  return [valueAt(before.canonical, segments), valueAt(after.canonical, segments)];
}

/**
 * Absent and present differ even when the value is null: a Swiss time limit that is absent reads
 * the pool's, and one that is null has no limit. The hash tells them apart too: an absent key is
 * not serialized, and a key present with no value is serialized as null (`valueAt` reads it so).
 */
function differs(a: unknown, b: unknown): boolean {
  return (a === undefined) !== (b === undefined) || stableStringify(a) !== stableStringify(b);
}

/** The one `unknown` entry over every leaf no listed path covers, or null when none changed. */
function unlistedChange(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): RulesChange | null {
  const listed = SCORING_CHANGE_PATHS.map((path) => path.split('.'));
  const seen = new Set<string>();
  const was: Record<string, unknown> = {};
  const now: Record<string, unknown> = {};
  for (const leaf of [...leavesOf(before), ...leavesOf(after)]) {
    const name = leaf.join('.');
    if (seen.has(name) || listed.some((path) => isPrefix(path, leaf))) continue;
    seen.add(name);
    const pair = [valueAt(before, leaf), valueAt(after, leaf)] as const;
    if (!differs(pair[0], pair[1])) continue;
    was[name] = pair[0];
    now[name] = pair[1];
  }
  return Object.keys(was).length === 0 ? null : { path: 'unknown', before: was, after: now };
}

/**
 * Every leaf of a canonical, as its key segments. A leaf is anything but a non-empty plain object:
 * an array is one leaf (a list is one setting), and so is an empty object (a new field `{}` must
 * still be seen).
 */
function leavesOf(value: unknown, prefix: string[] = [], out: string[][] = []): string[][] {
  if (isPlainObject(value) && Object.keys(value).length > 0) {
    for (const [key, child] of Object.entries(value)) leavesOf(child, [...prefix, key], out);
  } else if (prefix.length > 0) {
    out.push(prefix);
  }
  return out;
}

function valueAt(root: unknown, segments: readonly string[]): unknown {
  let value = root;
  for (const segment of segments) {
    if (!isPlainObject(value) || !Object.prototype.hasOwnProperty.call(value, segment)) {
      return undefined;
    }
    // A key present with no value: `stableStringify` writes it as null, so the diff reads it so.
    value = value[segment] ?? null;
  }
  return value;
}

function isPrefix(path: readonly string[], leaf: readonly string[]): boolean {
  return path.length <= leaf.length && path.every((segment, i) => segment === leaf[i]);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
