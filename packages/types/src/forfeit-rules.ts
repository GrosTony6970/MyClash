/**
 * forfeit-rules.ts — what a forfeit does, as a penalty ruleset sets it (operator rulings 63-76,
 * 2026-10-20)
 *
 * Every forfeit and disqualification rule lives in the PENALTY ruleset, beside its 1st and 2nd
 * black card settings. The scoring ruleset holds none (ruling 68). The Zod schema that checks a
 * stored value is `ForfeitRulesSchema` in `@myclash/rulesets`, pinned to this interface; this
 * subpath holds no Zod, so a screen can import it without the engine.
 */

/** A forfeit a Fighter chose, or an official recorded against them. Black cards are their own. */
export type ForfeitRuleReason = 'injury' | 'voluntary' | 'conduct_violation';

export const FORFEIT_RULE_REASONS: readonly ForfeitRuleReason[] = [
  'injury',
  'voluntary',
  'conduct_violation',
];

export interface ForfeitReasonRule {
  /** What the bout counts as: the score it stood at, or a loss of 0 to `opponentScore`. */
  outcome: 'keep_current' | 'fixed_loss';
  /** The forfeiting Fighter's opponent's score on a loss, 1-99. */
  opponentScore: number;
  /** What happens to the Fighter: continues, the official is asked, withdrawn, or disqualified. */
  fighter: 'continues' | 'asks' | 'withdrawn' | 'disqualified';
}

export interface ForfeitRules {
  reasons: Record<ForfeitRuleReason, ForfeitReasonRule>;
  /** The Fighter's own forfeits that disqualify them, 1-10, or `'off'`. */
  disqualifyAfter: number | 'off';
  /** A forfeit before the Fighter's 1st bout is fought disqualifies them. */
  disqualifyBeforeFirstBout: boolean;
  /** A black card forfeit is a loss of 0 to this, 1-99 (ruling 69). */
  blackCardOpponentScore: number;
}

const START_REASONS: ForfeitRules['reasons'] = {
  injury: { outcome: 'keep_current', opponentScore: 6, fighter: 'asks' },
  voluntary: { outcome: 'fixed_loss', opponentScore: 6, fighter: 'asks' },
  conduct_violation: { outcome: 'fixed_loss', opponentScore: 6, fighter: 'disqualified' },
};

/** The built-in FFAMHE penalty ruleset's: what a TF_v1 Tournament did before the move. */
export const FFAMHE_FORFEIT_RULES: ForfeitRules = {
  reasons: START_REASONS,
  disqualifyAfter: 2,
  disqualifyBeforeFirstBout: false,
  blackCardOpponentScore: 6,
};

/** What a brand-new club penalty ruleset starts with: "disqualify after" is off (ruling 67). */
export const CLUB_START_FORFEIT_RULES: ForfeitRules = {
  ...FFAMHE_FORFEIT_RULES,
  disqualifyAfter: 'off',
};

/** What a black card does to its Fighter: ends the bout, the whole Tournament, or nothing. */
export type BlackCardEffectName = 'match' | 'tournament' | 'none';

/**
 * The rules a Tournament plays under: its penalty ruleset's forfeit rules and black card
 * settings, with the Tournament's own changes laid over them (ruling 65).
 */
export interface ForfeitRulesInForce extends ForfeitRules {
  firstBlackCard: BlackCardEffectName;
  secondBlackCard: BlackCardEffectName;
}

/**
 * A Tournament's changes as stored (`tournaments.forfeit_rules`): only the keys it changed, at
 * any depth. A key it does not hold is the ruleset's.
 */
export interface ForfeitChanges {
  reasons?: Partial<Record<ForfeitRuleReason, Partial<ForfeitReasonRule>>>;
  disqualifyAfter?: number | 'off';
  disqualifyBeforeFirstBout?: boolean;
  blackCardOpponentScore?: number;
  firstBlackCard?: BlackCardEffectName;
  secondBlackCard?: BlackCardEffectName;
}

type Resettable<T> = { [K in keyof T]?: T[K] | null };

/**
 * A save of a Tournament's changes: a key sent is set, a LEAF sent as `null` is a Reset (the key
 * is deleted), a key not sent is kept. `null` stands only at a leaf.
 */
export interface ForfeitPatch {
  reasons?: Partial<Record<ForfeitRuleReason, Resettable<ForfeitReasonRule>>>;
  disqualifyAfter?: number | 'off' | null;
  disqualifyBeforeFirstBout?: boolean | null;
  blackCardOpponentScore?: number | null;
  firstBlackCard?: BlackCardEffectName | null;
  secondBlackCard?: BlackCardEffectName | null;
}

type Tree = Record<string, unknown>;
const isTree = (value: unknown): value is Tree =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function patchTree(stored: Tree, patch: Tree): Tree {
  const next: Tree = { ...stored };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) {
      delete next[key];
    } else if (isTree(value)) {
      const child = patchTree(isTree(next[key]) ? next[key] : {}, value);
      // A parent a Reset emptied goes too: an empty object would read as a change.
      if (Object.keys(child).length > 0) next[key] = child;
      else delete next[key];
    } else {
      next[key] = value;
    }
  }
  return next;
}

/** The stored changes after `patch`; nothing left is `null` (the Tournament changes nothing). */
export function applyForfeitPatch(
  stored: ForfeitChanges | null,
  patch: ForfeitPatch,
): ForfeitChanges | null {
  const next = patchTree((stored ?? {}) as Tree, patch as Tree);
  return Object.keys(next).length > 0 ? (next as ForfeitChanges) : null;
}

/**
 * The rules in force: `changes` over `ruleset`. A key the changes lack, or hold as `null` (a
 * Reset not yet saved, in a screen's form), is the ruleset's. The one merge of the server and
 * the screens.
 */
export function mergeForfeitRules(
  ruleset: ForfeitRulesInForce,
  changes: ForfeitChanges | ForfeitPatch | null,
): ForfeitRulesInForce {
  const reasonOf = (reason: ForfeitRuleReason): ForfeitReasonRule => {
    const base = ruleset.reasons[reason];
    const changed = changes?.reasons?.[reason];
    return {
      outcome: changed?.outcome ?? base.outcome,
      opponentScore: changed?.opponentScore ?? base.opponentScore,
      fighter: changed?.fighter ?? base.fighter,
    };
  };
  return {
    reasons: {
      injury: reasonOf('injury'),
      voluntary: reasonOf('voluntary'),
      conduct_violation: reasonOf('conduct_violation'),
    },
    disqualifyAfter: changes?.disqualifyAfter ?? ruleset.disqualifyAfter,
    disqualifyBeforeFirstBout:
      changes?.disqualifyBeforeFirstBout ?? ruleset.disqualifyBeforeFirstBout,
    blackCardOpponentScore: changes?.blackCardOpponentScore ?? ruleset.blackCardOpponentScore,
    firstBlackCard: changes?.firstBlackCard ?? ruleset.firstBlackCard,
    secondBlackCard: changes?.secondBlackCard ?? ruleset.secondBlackCard,
  };
}

/** Per reason, whether its rule asks "can the Fighter continue?" (`GET .../match-config`). */
export type ForfeitAsks = Record<ForfeitRuleReason, boolean>;

export function forfeitAsksOf(rules: ForfeitRules): ForfeitAsks {
  const asks = (reason: ForfeitRuleReason) => rules.reasons[reason].fighter === 'asks';
  return {
    injury: asks('injury'),
    voluntary: asks('voluntary'),
    conduct_violation: asks('conduct_violation'),
  };
}

/**
 * "Can the Fighter continue?" is a question of a Pool or Swiss bout only (ruling 76); on a bracket
 * bout the Fighter continues in the Tournament. A screen that does not know the bout's phase asks,
 * and the server decides by the phase it reads.
 */
export function asksInPhase(phaseType: string | null | undefined): boolean {
  return phaseType == null || phaseType === 'pool' || phaseType === 'swiss';
}

export interface ForfeitQuestion {
  ask: boolean;
  /** The screen holds no answer of the rules, so it asks: the pad says so. */
  unconfirmed: boolean;
}

/**
 * Whether a forfeit screen asks "can the Fighter continue?" for `reason` (ruling 76): when its
 * rule asks, on a Pool or Swiss bout. A black card or an override is never asked: its own rule
 * says what it does. The server reads the answer by the same rule and the same phases.
 *
 * @param asks `undefined` while the rules are being read (asked); `null` when the screen holds no
 *   answer of them (asked, and `unconfirmed`).
 */
export function forfeitQuestion(
  reason: string,
  asks: ForfeitAsks | null | undefined,
  phaseType: string | null | undefined,
): ForfeitQuestion {
  const ruled = (FORFEIT_RULE_REASONS as readonly string[]).includes(reason);
  if (!ruled || !asksInPhase(phaseType)) return { ask: false, unconfirmed: false };
  if (asks === undefined) return { ask: true, unconfirmed: false };
  if (asks === null) return { ask: true, unconfirmed: true };
  return { ask: asks[reason as ForfeitRuleReason], unconfirmed: false };
}
