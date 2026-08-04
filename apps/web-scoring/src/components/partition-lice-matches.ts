/** How many upcoming bouts the NEXT section previews before the full list. */
export const NEXT_PREVIEW_COUNT = 5;

export interface PartitionedLiceMatches<T> {
  /** Bouts genuinely in progress on this piste. */
  live: T[];
  /** The next few scheduled bouts. */
  next: T[];
  /** Everything, in schedule order — what the "all matches" section shows. */
  all: T[];
}

/** Whether a match status means "happening on the piste right now". */
export function isLiveStatus(status: string | null | undefined): boolean {
  return status === 'running' || status === 'paused';
}

/**
 * Split a lice's day into the three things the operator reads.
 *
 * `live` is an ARRAY and it is filtered on STATUS with no fallback. Both
 * details are the bug fix: the old payload fell back to "the first match in the
 * queue" when nothing was running, so a merely SCHEDULED bout was rendered
 * under a "LIVE" heading. And a `find()` would hide the case where two matches
 * are running on one piste because an operator forgot to end one — rendering
 * both is honest, and surfaces the mistake instead of concealing it.
 */
export function partitionLiceMatches<T extends { id: string; status: string }>(
  matches: readonly T[],
  nextCount: number = NEXT_PREVIEW_COUNT,
): PartitionedLiceMatches<T> {
  const all = [...matches];
  return {
    live: all.filter((match) => isLiveStatus(match.status)),
    next: all.filter((match) => match.status === 'scheduled').slice(0, nextCount),
    all,
  };
}
