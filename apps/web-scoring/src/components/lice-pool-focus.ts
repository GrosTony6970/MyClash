/**
 * Which parts of a tournament's pools and bracket belong to this piste.
 *
 * Structurally typed and React-free on purpose, mirroring web-public's
 * `self-pool-highlight.ts`: the API shapes can move without dragging this with
 * them, and it stays unit-testable under vitest's node environment.
 */

/** Minimal shape of a pool row from `pools-with-matches`. */
export interface FocusPool {
  poolId: string;
  poolName: string;
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
    };
  });
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
