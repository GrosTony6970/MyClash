/**
 * What undoing THIS result actually does, keyed on what the pre-flight found.
 *
 * Same shape and the same reason as `void-confirm-copy.ts`: the defect that file
 * exists to prevent was a LIE, not a crash — one confirm string promised
 * organisers something the code did not do, and acting on it is how a fighter
 * ends up unlisted at a piste. The copy here has more to be wrong about, because
 * the destructive case throws away bouts that were actually fought.
 *
 * Copy lives in i18n; this owns which sentences apply. Pure and free of React so
 * the mapping is pinned by tests rather than typed inline in JSX.
 */

/** `GET /matches/:id/uncomplete-preflight`, as the organiser app receives it. */
export interface UncompletePreflight {
  affected: Array<{
    label: string | null;
    redName: string | null;
    blueName: string | null;
    round: number;
    status: string | null;
    hasBeenFought: boolean;
    locked: boolean;
  }>;
  foughtCount: number;
  blocked: boolean;
  canDiscard: boolean;
  frozen: boolean;
  /** Live forfeit records this un-completion would void. Absent on older deploys. */
  forfeitsToVoid?: number;
  /** One of them reached beyond its own bout, so the whole call refuses. */
  forfeitBlocked?: boolean;
  /** A reserve took a no-show's place. That substitution is NOT undone. */
  forfeitReplacedFighter?: boolean;
}

export interface CopyLine {
  key: string;
  values?: Record<string, string | number>;
}

export interface UncompleteConfirmCopy {
  /** The confirm body, in order. Joined into one paragraph by the caller. */
  body: CopyLine[];
  /**
   * The sentence that must be readable WITHOUT opening the dialog — the panel is
   * what an organiser looks at before deciding to click at all. Null when the
   * only consequence is the generic one the panel already states.
   */
  hint: CopyLine | null;
  /** Whether the dialog may offer to proceed, and whether it needs the tick. */
  action: 'proceed' | 'acknowledge' | 'refused';
}

// Literal keys, never composed — the i18n reverse sweep resolves a dotted string
// literal but needs a MANUAL_PREFIXES entry for anything templated.
const EMPTIES_NONE = 'organizer.matchDetail.uncompleteBodyEmptiesNone';
const EMPTIES_ONE = 'organizer.matchDetail.uncompleteBodyEmptiesOne';
const EMPTIES_MANY = 'organizer.matchDetail.uncompleteBodyEmptiesMany';
const DISCARDS_ONE = 'organizer.matchDetail.uncompleteBodyDiscardsOne';
const DISCARDS_MANY = 'organizer.matchDetail.uncompleteBodyDiscardsMany';
const BACK_ON_SCHEDULE = 'organizer.matchDetail.uncompleteBodyBackOnSchedule';
const REFILLS = 'organizer.matchDetail.uncompleteBodyRefills';
const ASK_ORGANISER = 'organizer.matchDetail.uncompleteBodyAskOrganiser';
const FROZEN = 'organizer.matchDetail.uncompleteBodyFrozen';
const FORFEIT_VOIDED = 'organizer.matchDetail.uncompleteBodyForfeitVoided';
const FORFEIT_BLOCKED = 'organizer.matchDetail.uncompleteBodyForfeitBlocked';
const FORFEIT_REPLACEMENT = 'organizer.matchDetail.uncompleteBodyForfeitReplacement';

/**
 * `t()` has no plural engine, so a count of one needs its own key rather than
 * "the 1 later bouts". Same convention as `voidRecordBodyReopensOne`.
 */
const counted = (one: string, many: string, count: number): CopyLine =>
  count === 1 ? { key: one } : { key: many, values: { count } };

/** One sentence, said the same way wherever it applies. */
const refusal = (key: string): UncompleteConfirmCopy => ({
  body: [{ key }],
  hint: { key },
  action: 'refused',
});

/**
 * What the forfeit records add to the body.
 *
 * Stated wherever it applies: an F disappearing from the standings is exactly
 * the kind of side effect an organiser will not predict from the word "undo",
 * and a reserve substitution SURVIVING the undo is the other one.
 */
function forfeitLines(preflight: UncompletePreflight): CopyLine[] {
  return [
    ...((preflight.forfeitsToVoid ?? 0) > 0 ? [{ key: FORFEIT_VOIDED }] : []),
    ...(preflight.forfeitReplacedFighter ? [{ key: FORFEIT_REPLACEMENT }] : []),
  ];
}

export function uncompleteConfirmCopy(
  preflight: UncompletePreflight | null | undefined,
): UncompleteConfirmCopy {
  // No pre-flight — it failed to load, or this is a deploy without the endpoint.
  // Say only what is true of every un-completion. Guessing "nothing downstream"
  // here would be the same class of lie the void copy exists to remove.
  if (!preflight) return { body: [{ key: EMPTIES_NONE }], hint: null, action: 'proceed' };

  // The freeze outranks everything: a completed event refuses the write whatever
  // the organiser ticks, so offering the action at all would be a dead end.
  if (preflight.frozen) return refusal(FROZEN);

  // A forfeit that withdrew the fighter, or that auto-forfeited their other
  // bouts, is refused by the API whatever else is true — ranked above the fought
  // dependents for the same reason the freeze is. Its remedy is a different
  // screen, so the copy has to name it.
  if (preflight.forfeitBlocked) return refusal(FORFEIT_BLOCKED);

  const emptied = preflight.affected.length;
  const forfeits = forfeitLines(preflight);

  if (!preflight.blocked) {
    // Nothing was fought, so nothing is lost. Two shapes only, because "the 0
    // later bouts are emptied" is not a sentence.
    const body =
      emptied === 0
        ? [{ key: EMPTIES_NONE }]
        : [counted(EMPTIES_ONE, EMPTIES_MANY, emptied), { key: REFILLS }];
    return {
      body: [...body, ...forfeits],
      hint: forfeits[0] ?? null,
      action: 'proceed',
    };
  }

  // Fought bouts exist. The consequence sentence is the one that must also be on
  // the panel: this is where results get thrown away.
  const discards = counted(DISCARDS_ONE, DISCARDS_MANY, preflight.foughtCount);

  if (!preflight.canDiscard) {
    return { body: [discards, { key: ASK_ORGANISER }], hint: discards, action: 'refused' };
  }

  return {
    body: [discards, { key: BACK_ON_SCHEDULE }, { key: REFILLS }, ...forfeits],
    hint: discards,
    action: 'acknowledge',
  };
}
