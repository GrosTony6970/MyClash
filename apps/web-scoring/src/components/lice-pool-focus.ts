/**
 * Which parts of a tournament's pools and bracket belong to this piste.
 *
 * Structurally typed and React-free on purpose, mirroring web-public's
 * `self-pool-highlight.ts`: the API shapes can move without dragging this with
 * them, and it stays unit-testable under vitest's node environment.
 */

/** One of a pool's default referees, carried through to the header. */
export interface FocusReferee {
  role: string;
  roleLabel: string;
  roleColor: string;
  name: string;
}

/** Minimal shape of a pool row from `pools-with-matches`. */
export interface FocusPool {
  poolId: string;
  poolName: string;
  referees?: readonly FocusReferee[];
  liceNames?: readonly string[];
  matches: ReadonlyArray<{ id: string; lice_id: string | null }>;
}

export interface LicePoolSummary {
  poolId: string;
  poolName: string;
  /** Ids of this pool's matches that run on this lice. */
  onThisLice: string[];
  /** Every match in the pool, wherever it runs. */
  total: number;
  /** Whether the pool touches this lice at all. */
  anyOnThisLice: boolean;
  /** The pool's default crew, for the header. Empty when none is assigned. */
  referees: FocusReferee[];
  /** Every piste the pool's matches run on. */
  liceNames: string[];
}

/**
 * Per-pool counts of "mine vs all".
 *
 * Counts rather than a binary badge because `pools` has NO `lice_id` column —
 * a pool's piste is derived from its matches, and "a pool runs on one lice" is
 * an assumption the schema never enforces. A pool split across two pistes is
 * legal, so the UI reports "4 of 6" instead of claiming the pool.
 *
 * Pools with nothing on this lice are kept: the operator asked to see them all.
 */
export function buildLicePoolSummaries(
  pools: readonly FocusPool[],
  liceId: string,
): LicePoolSummary[] {
  return pools.map((pool) => {
    const onThisLice = pool.matches.filter((m) => m.lice_id === liceId).map((m) => m.id);
    return {
      poolId: pool.poolId,
      poolName: pool.poolName,
      onThisLice,
      total: pool.matches.length,
      anyOnThisLice: onThisLice.length > 0,
      referees: [...(pool.referees ?? [])],
      liceNames: [...(pool.liceNames ?? [])],
    };
  });
}

/**
 * This piste's pools first, everything else after, each side keeping the
 * organiser's own `sort_order`.
 *
 * The operator opens this screen to answer "which pool am I running", and on a
 * four-pool tournament theirs was as likely to be last as first. A STABLE
 * partition rather than a sort: reordering the pools they are *not* on would
 * make the section disagree with every other list of pools in the product.
 */
export function orderLicePoolSummaries(summaries: readonly LicePoolSummary[]): LicePoolSummary[] {
  return [
    ...summaries.filter((summary) => summary.anyOnThisLice),
    ...summaries.filter((summary) => !summary.anyOnThisLice),
  ];
}

/** Minimal shape of a bracket slot. */
export interface FocusSlot {
  id: string;
  round: number;
  position: number;
  liceId?: string | null;
}

export interface LiceBracketFocus {
  highlightedSlotIds: string[];
  /**
   * Slot to scroll into view: this lice's EARLIEST bout (lowest round, then
   * lowest position) — the operator's next duty. A fighter's bracket scrolls to
   * their furthest round; a piste is not a fighter, it works forwards.
   */
  scrollTargetSlotId: string | null;
  count: number;
}

export function buildLiceBracketFocus(
  slots: readonly FocusSlot[],
  liceId: string,
): LiceBracketFocus {
  const mine = slots.filter((slot) => slot.liceId === liceId);
  const earliest = mine.reduce<FocusSlot | null>((best, slot) => {
    if (!best) return slot;
    if (slot.round !== best.round) return slot.round < best.round ? slot : best;
    return slot.position < best.position ? slot : best;
  }, null);
  return {
    highlightedSlotIds: mine.map((slot) => slot.id),
    scrollTargetSlotId: earliest?.id ?? null,
    count: mine.length,
  };
}
