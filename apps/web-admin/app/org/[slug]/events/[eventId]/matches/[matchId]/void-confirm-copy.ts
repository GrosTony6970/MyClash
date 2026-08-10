/**
 * What voiding THIS record actually does, keyed on where it sits in the cascade.
 *
 * The single `voidRecordBody` string this replaces was factually wrong for a
 * cascaded child. It promised "the other bouts this record closed are reopened
 * too" — and a child closed nothing: it was itself closed by a withdrawal
 * recorded on another bout. An organiser reading it would expect the fighter
 * back in the tournament, and the fighter stays withdrawn.
 *
 * Copy lives in i18n; this owns which sentences apply. Pure and free of React,
 * following the `readiness-copy.ts` pattern, so the mapping is pinned by tests
 * rather than typed inline in JSX.
 */

/** `ForfeitCascadeContext` as it arrives from `GET /matches/:id/forfeit`. */
export interface ForfeitCascade {
  role: 'root' | 'child' | 'standalone';
  /** Live children this void would carry down. */
  childCount: number;
  /** For a child: is the record that withdrew the fighter still on record? */
  parentActive: boolean;
}

export interface CopyLine {
  key: string;
  values?: Record<string, string | number>;
}

export interface VoidConfirmCopy {
  /** The confirm body, in order. Joined into one paragraph by the caller. */
  body: CopyLine[];
  /**
   * The one sentence that must also be readable WITHOUT opening the dialog.
   * Null for a standalone record, whose only consequence is the generic one
   * the panel already states.
   */
  hint: CopyLine | null;
}

// Literal keys, never composed — the i18n reverse sweep resolves a dotted
// string literal but needs a MANUAL_PREFIXES entry for anything templated.
const RESTORES = 'organizer.bracketPage.voidRecordBodyRestores';
const UNADVANCES = 'organizer.bracketPage.voidRecordBodyUnadvances';
const REOPENS_ONE = 'organizer.bracketPage.voidRecordBodyReopensOne';
const REOPENS_MANY = 'organizer.bracketPage.voidRecordBodyReopensMany';
const CHILD_STAYS_WITHDRAWN = 'organizer.bracketPage.voidRecordBodyChildStaysWithdrawn';
const CHILD_PARENT_GONE = 'organizer.bracketPage.voidRecordBodyChildParentGone';

/** Restore + un-advance: true of every record, and the whole story for most. */
function standalone(): VoidConfirmCopy {
  return { body: [{ key: RESTORES }, { key: UNADVANCES }], hint: null };
}

export function voidConfirmCopy(cascade: ForfeitCascade | null | undefined): VoidConfirmCopy {
  // No cascade block — a record read before this shipped, or a response that
  // lost it. Say only what is true of every record; guessing `root` here would
  // reinstate the lie this function exists to remove.
  if (!cascade) return standalone();

  if (cascade.role === 'child') {
    // `parentActive` is the reason the API computes this at all: the row says a
    // parent EXISTS, never whether it still stands, and the two cases give the
    // organiser opposite instructions about checking the fighter back in.
    const line = {
      key: cascade.parentActive ? CHILD_STAYS_WITHDRAWN : CHILD_PARENT_GONE,
    };
    return { body: [{ key: RESTORES }, line], hint: line };
  }

  // `root` with no live children is not a shape the API produces — role is
  // derived from the count. Falling through rather than trusting it keeps the
  // copy from reading "the 0 other bouts" if that ever changes.
  if (cascade.role === 'root' && cascade.childCount > 0) {
    const line =
      cascade.childCount === 1
        ? { key: REOPENS_ONE }
        : { key: REOPENS_MANY, values: { count: cascade.childCount } };
    return { body: [{ key: RESTORES }, line, { key: UNADVANCES }], hint: line };
  }

  return standalone();
}
