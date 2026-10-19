/**
 * What changed in a Tournament's scoring rules, as a list of paths (the audited settings change,
 * its plan's revisions 7-11). ONE owner of the list: `scoringDiff` (`@myclash/rulesets`) emits only
 * these paths, the words of each live here, and the API, web-admin and web-public read them from
 * here. A path names a leaf of the scoring canonical (`canonicalizeScoringBehaviour`) or a button
 * value; a list the organiser names (targets, a level chain, constants, tiebreakers, a policy, a
 * formula) is ONE path whose value is the whole list.
 *
 * `unknown` is what `scoringDiff` emits for a leaf of the canonical that is not on the list: it
 * locks like any scoring key and reads "another scoring setting changed" — a new canonical field
 * is never a change the lock cannot see.
 */

import type { FormatPhase } from '@myclash/rules';

/** The format phases of a bout (`formatPhaseOf`, `@myclash/rules`): a pool key is a Tournament key. */
export type { FormatPhase };

/** The `matchFormat` keys that hold one value per format phase. */
const PHASED_KEYS: ReadonlySet<string> = new Set(['timeLimitsSeconds', 'bestOf', 'levelAtTime']);

const PER_PHASE = (key: 'timeLimitsSeconds' | 'bestOf' | 'levelAtTime') =>
  [
    `matchFormat.${key}.pool`,
    `matchFormat.${key}.swiss`,
    `matchFormat.${key}.bracket`,
    `matchFormat.${key}.finals`,
  ] as const;

export const RULES_CHANGE_PATHS = [
  'kind',
  'engine',
  'decisionEdition',
  'grammar.targets',
  'grammar.hasAfterblow',
  'grammar.afterblowValuation',
  'grammar.afterblowFixedValue',
  'afterblowMode',
  'matchFormat.pointCap',
  'matchFormat.scoringDirection',
  'matchFormat.timerMode',
  ...PER_PHASE('timeLimitsSeconds'),
  'matchFormat.softClockLimitSeconds',
  'matchFormat.maxDoubleHits',
  'matchFormat.maxDoubleHitOutcome',
  ...PER_PHASE('bestOf'),
  ...PER_PHASE('levelAtTime'),
  'tournamentPolicy',
  'winBonus',
  'forfeitPolicy',
  'doublePenaltyFormula',
  'scoreFormula',
  'constants',
  'tiebreakers',
  'buttons.clean',
  'buttons.afterblow',
] as const;

export type RulesChangePath = (typeof RULES_CHANGE_PATHS)[number] | 'unknown';

/** One change: the value before and after, and whether the lock refused it on its own. */
export interface RulesChange {
  path: RulesChangePath;
  before: unknown;
  after: unknown;
  /** Set by the lock (`lockedChanges`) and by a re-pin (always true): this entry needs the audit. */
  locked?: boolean;
}

/**
 * The codes of the refusals around a rules change, one owner for the API that throws them and the
 * web apps that word them (`rules-change-refusal.ts` in web-admin).
 */
export const RULES_CHANGE_CODES = {
  /** 403: a scoring change the lock refuses without the audit; the body's `details.changes`. */
  needsAudit: 'rules_change_needs_audit',
  /** 403: a completed or archived Tournament: no door changes its rules. */
  closed: 'rules_change_closed',
  /** 409: the rules moved since the screen read them (`expected`), or since the save's own read. */
  changedSinceRead: 'rules_changed_since_read',
  /** 400: the typed name is not the Tournament's (`sameTournamentName`). */
  confirmMismatch: 'rules_confirm_mismatch',
  /** 400: an audited change that changes nothing. */
  unchanged: 'rules_unchanged',
  /** 400: an audited settings save that also carries a field that is not a rule. */
  mixed: 'rules_change_mixed',
  /** 503: the rules could not be read to be compared (operational). */
  checkUnavailable: 'rules_check_unavailable',
  /** 403: a card rules change refused on the Tournament's clock. */
  cardLocked: 'card_change_locked',
} as const;

export type RulesChangeCode = (typeof RULES_CHANGE_CODES)[keyof typeof RULES_CHANGE_CODES];

/**
 * What the screen read of a Tournament's rules, sent back with an audited change so the server
 * can refuse it when the rules moved since (operator ruling "Stale screen"). The RAW stored values,
 * as the Tournament row holds them: never normalized, never defaulted.
 */
export interface RulesExpected {
  rulesetCode: string | null;
  rulesetVersion: string | null;
  rulesetConfig: Record<string, unknown> | null;
  scoringConfig: Record<string, unknown> | null;
  penaltyRulesetId: string | null;
  penaltyRulesetVersion: string | null;
}

/**
 * One rules change of a Tournament as the PUBLIC notice shows it, newest first (operator rulings
 * "Public notice", "Version notice", "Private formula"). `changes` already has a club formula's
 * own values stripped by the API when `privateFormula` is set; `rulesChangeLines(changes, t,
 * { privateFormula })` words them.
 */
export interface RulesChangeNotice {
  kind: 'ruleset' | 'settings';
  changedAt: string;
  /** Both sides are one ruleset code: two rulesets may share a label, never a code. */
  sameRuleset: boolean;
  fromLabel: string;
  fromVersion: string;
  toLabel: string;
  toVersion: string;
  justification: string;
  changes: RulesChange[];
  privateFormula: boolean;
}

/**
 * The paths whose values are a club formula's own definition. The PUBLIC notice carries them as a
 * path only, worded "the scoring formula changed", whenever either side of the change is a club
 * ruleset (operator ruling "Private formula", 2026-10-19).
 */
export const FORMULA_STRUCTURE_PATHS: ReadonlySet<RulesChangePath> = new Set([
  'scoreFormula',
  'constants',
  'tiebreakers',
  'doublePenaltyFormula',
]);

/**
 * The format phase a per-phase path belongs to (`matchFormat.bestOf.finals` → `finals`), else
 * null. The lock reads it: such a path locks once a bout of THAT phase has started.
 */
export function formatPhaseOfPath(path: RulesChangePath): FormatPhase | null {
  const [root, key, phase] = path.split('.');
  return root === 'matchFormat' && key !== undefined && PHASED_KEYS.has(key)
    ? (phase as FormatPhase)
    : null;
}

/**
 * The words of each path, as WHOLE key literals: the i18n reverse sweep scans this directory and
 * must find every key. `engine` and `decisionEdition` both read "how a bout ends" (operator
 * ruling: a same-code version move shows that one line).
 */
export const rulesChangeKey: Record<RulesChangePath, string> = {
  kind: 'common.rulesChange.path.kind',
  engine: 'common.rulesChange.path.engine',
  decisionEdition: 'common.rulesChange.path.decisionEdition',
  'grammar.targets': 'common.rulesChange.path.targets',
  'grammar.hasAfterblow': 'common.rulesChange.path.hasAfterblow',
  'grammar.afterblowValuation': 'common.rulesChange.path.afterblowValuation',
  'grammar.afterblowFixedValue': 'common.rulesChange.path.afterblowFixedValue',
  afterblowMode: 'common.rulesChange.path.afterblowMode',
  'matchFormat.pointCap': 'common.rulesChange.path.pointCap',
  'matchFormat.scoringDirection': 'common.rulesChange.path.scoringDirection',
  'matchFormat.timerMode': 'common.rulesChange.path.timerMode',
  'matchFormat.timeLimitsSeconds.pool': 'common.rulesChange.path.timeLimitPool',
  'matchFormat.timeLimitsSeconds.swiss': 'common.rulesChange.path.timeLimitSwiss',
  'matchFormat.timeLimitsSeconds.bracket': 'common.rulesChange.path.timeLimitBracket',
  'matchFormat.timeLimitsSeconds.finals': 'common.rulesChange.path.timeLimitFinals',
  'matchFormat.softClockLimitSeconds': 'common.rulesChange.path.softClock',
  'matchFormat.maxDoubleHits': 'common.rulesChange.path.maxDoubleHits',
  'matchFormat.maxDoubleHitOutcome': 'common.rulesChange.path.maxDoubleHitOutcome',
  'matchFormat.bestOf.pool': 'common.rulesChange.path.bestOfPool',
  'matchFormat.bestOf.swiss': 'common.rulesChange.path.bestOfSwiss',
  'matchFormat.bestOf.bracket': 'common.rulesChange.path.bestOfBracket',
  'matchFormat.bestOf.finals': 'common.rulesChange.path.bestOfFinals',
  'matchFormat.levelAtTime.pool': 'common.rulesChange.path.levelAtTimePool',
  'matchFormat.levelAtTime.swiss': 'common.rulesChange.path.levelAtTimeSwiss',
  'matchFormat.levelAtTime.bracket': 'common.rulesChange.path.levelAtTimeBracket',
  'matchFormat.levelAtTime.finals': 'common.rulesChange.path.levelAtTimeFinals',
  tournamentPolicy: 'common.rulesChange.path.tournamentPolicy',
  winBonus: 'common.rulesChange.path.winBonus',
  forfeitPolicy: 'common.rulesChange.path.forfeitPolicy',
  doublePenaltyFormula: 'common.rulesChange.path.doublePenaltyFormula',
  scoreFormula: 'common.rulesChange.path.scoreFormula',
  constants: 'common.rulesChange.path.constants',
  tiebreakers: 'common.rulesChange.path.tiebreakers',
  'buttons.clean': 'common.rulesChange.path.cleanButtons',
  'buttons.afterblow': 'common.rulesChange.path.afterblowButtons',
  unknown: 'common.rulesChange.path.unknown',
};

const LINE_KEY = 'common.rulesChange.line';
const CHANGED_KEY = 'common.rulesChange.changed';
const FORMULA_CHANGED_KEY = 'common.rulesChange.formulaChanged';
const SECONDS_KEY = 'common.rulesChange.value.seconds';

/** A value shown as a bare number. */
const NUMBER_PATHS: ReadonlySet<RulesChangePath> = new Set<RulesChangePath>([
  'grammar.afterblowFixedValue',
  'matchFormat.pointCap',
  'matchFormat.maxDoubleHits',
  'matchFormat.bestOf.pool',
  'matchFormat.bestOf.swiss',
  'matchFormat.bestOf.bracket',
  'matchFormat.bestOf.finals',
  'winBonus',
]);

/** A value shown in seconds. */
const SECONDS_PATHS: ReadonlySet<RulesChangePath> = new Set<RulesChangePath>([
  'matchFormat.timeLimitsSeconds.pool',
  'matchFormat.timeLimitsSeconds.swiss',
  'matchFormat.timeLimitsSeconds.bracket',
  'matchFormat.timeLimitsSeconds.finals',
  'matchFormat.softClockLimitSeconds',
]);

/** A null here is "no limit" (`normalizeMatchFormatConfig`: a null clock or ceiling is off). */
const LIMIT_PATHS: ReadonlySet<RulesChangePath> = new Set<RulesChangePath>([
  'matchFormat.timeLimitsSeconds.pool',
  'matchFormat.timeLimitsSeconds.swiss',
  'matchFormat.timeLimitsSeconds.bracket',
  'matchFormat.timeLimitsSeconds.finals',
  'matchFormat.maxDoubleHits',
]);

/** The known values of each enum path (`match-format.ts`, `content-hash.ts`, `AfterblowMode`). */
const ENUM_VALUE_KEYS: Partial<Record<RulesChangePath, Readonly<Record<string, string>>>> = {
  kind: {
    coded: 'common.rulesChange.value.coded',
    formula: 'common.rulesChange.value.formula',
  },
  'grammar.afterblowValuation': {
    fixed: 'common.rulesChange.value.valuationFixed',
    weighted: 'common.rulesChange.value.valuationWeighted',
  },
  afterblowMode: {
    full: 'common.rulesChange.value.afterblowFull',
    deductive: 'common.rulesChange.value.afterblowDeductive',
  },
  'matchFormat.scoringDirection': {
    normal: 'common.rulesChange.value.scoringNormal',
    reverse_zero_loses: 'common.rulesChange.value.scoringReverse',
  },
  'matchFormat.timerMode': {
    countdown: 'common.rulesChange.value.countdown',
    countup: 'common.rulesChange.value.countup',
  },
  'matchFormat.maxDoubleHitOutcome': {
    double_loss_zero_scores: 'common.rulesChange.value.doubleLoss',
    draw_zero_scores: 'common.rulesChange.value.doubleDraw',
    result_stands: 'common.rulesChange.value.resultStands',
  },
};

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * The words for an empty value. An absent Swiss key follows the pool's (`match-format.ts`: the
 * Swiss keys are optional, falling back to `pool`); `scoringDiff` keeps it absent, so it crosses
 * JSON as a missing `before` or `after`. Absent elsewhere is no known shape: null, so "changed".
 * A null limit is "no limit"; a null afterblow mode is the engine's default (`full`).
 */
function emptyValueKey(path: RulesChangePath, value: null | undefined): string | null {
  if (value === undefined) {
    return formatPhaseOfPath(path) === 'swiss' ? 'common.rulesChange.value.asPool' : null;
  }
  if (LIMIT_PATHS.has(path)) return 'common.rulesChange.value.noLimit';
  // A null afterblow mode is the engine's (`full`), a null win bonus TF_v1's (3): a default.
  return path === 'afterblowMode' || path === 'winBonus'
    ? 'common.rulesChange.value.default'
    : 'common.rulesChange.value.none';
}

/** Whether a path holds one value a line can show; a list or an object reads "changed". */
function showsValue(path: RulesChangePath): boolean {
  return (
    NUMBER_PATHS.has(path) ||
    SECONDS_PATHS.has(path) ||
    Object.hasOwn(ENUM_VALUE_KEYS, path) ||
    path === 'grammar.hasAfterblow'
  );
}

/**
 * One value of a `showsValue` path in words, or null when it cannot be worded: a value outside
 * its path's known shape (an enum value this build does not know, a string where a number
 * belongs). The caller then writes "changed" rather than show a raw code to an organiser.
 */
function valueWords(path: RulesChangePath, value: unknown, t: Translate): string | null {
  if (value === null || value === undefined) {
    const key = emptyValueKey(path, value);
    return key === null ? null : t(key);
  }
  const enumKeys = ENUM_VALUE_KEYS[path];
  if (enumKeys) {
    return typeof value === 'string' && Object.hasOwn(enumKeys, value) ? t(enumKeys[value]!) : null;
  }
  if (path === 'grammar.hasAfterblow') {
    if (typeof value !== 'boolean') return null;
    return t(value ? 'common.rulesChange.value.yes' : 'common.rulesChange.value.no');
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (SECONDS_PATHS.has(path)) return t(SECONDS_KEY, { seconds: value });
  return String(value);
}

/** One change in words: "Label: before → after" for a value, "Label changed" for the rest. */
function changeLine(change: RulesChange, t: Translate): string {
  // A path this build does not know (an older page reading a newer server) reads as `unknown`.
  const path: RulesChangePath = Object.hasOwn(rulesChangeKey, change.path)
    ? change.path
    : 'unknown';
  const label = t(rulesChangeKey[path]);
  if (showsValue(path)) {
    const before = valueWords(path, change.before, t);
    const after = valueWords(path, change.after, t);
    if (before !== null && after !== null) return t(LINE_KEY, { label, before, after });
  }
  return t(CHANGED_KEY, { label });
}

/**
 * The changes in words, one line each, for web-admin and web-public alike (ONE value formatter).
 * A list or object path (targets, a level chain, a formula, a policy, the button values) always
 * reads "changed". With `privateFormula` (the public notice, when either side of the change is a
 * club ruleset: operator ruling "Private formula"), the formula, its constants, its tie-breakers
 * and its double-hit penalty read as ONE line, "The scoring formula changed". Identical lines are
 * shown once: three unlisted settings are one line.
 */
export function rulesChangeLines(
  changes: readonly RulesChange[],
  t: Translate,
  options: { privateFormula?: boolean } = {},
): string[] {
  return [
    ...new Set(
      changes.map((change) =>
        options.privateFormula && FORMULA_STRUCTURE_PATHS.has(change.path)
          ? t(FORMULA_CHANGED_KEY)
          : changeLine(change, t),
      ),
    ),
  ];
}

/** A name as compared: one Unicode form, trimmed, runs of whitespace as one space, lower case. */
function comparableName(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Whether a typed name is the Tournament's name (operator ruling "Typed name"): case and runs of
 * whitespace do not count, accents do ('Épée Dames' is not 'Epee dames'). The dialog's confirm
 * button and the server both ask this, so they never disagree.
 *
 * `toLowerCase`, not `toLocaleLowerCase`: the locale form depends on the machine (a Turkish
 * browser lowers 'I' to a dotless 'ı'), and the server and the browser must give one answer.
 * NFC first: an 'É' typed as 'E' plus a combining accent is the same name.
 */
export function sameTournamentName(a: string, b: string): boolean {
  return comparableName(a) === comparableName(b);
}
