/**
 * Branch-aware grouping for single-elimination bracket scheduling.
 *
 * The operator's model: each quarter-final (and the whole sub-tree feeding it)
 * runs on the SAME lice; those sub-trees spread across the lices; the rounds
 * above (semi-finals, final) converge onto one of the contributing lices.
 *
 * Generalised: the "spread round" is the round whose theoretical size best
 * matches the lice count — `spreadRound = max(1, maxRound - floor(log2 lices))`.
 * A slot at round r ≤ spreadRound folds into the anchor at spread-round
 * position `ceil(position / 2^(spreadRound - r))` (so round-0 play-ins fold the
 * same way); rounds above the spread round form one converge unit.
 *
 * The theoretical round size (`2^(maxRound - r)`) — not the surviving slot
 * count — drives the spread round so byes don't shift it.
 *
 * DOUBLE ELIMINATION spreads only the winners bracket. The losers bracket and
 * the grand final(s) join the converge unit, ordered by round, because an LB
 * round consumes the losers dropping out of a specific WB round — running the
 * LB in parallel with the WB it feeds off would schedule matches before their
 * entrants are known. Converge runs after the anchors on the last anchor's
 * lice, which is exactly the ordering that dependency needs.
 *
 * Pure: no I/O.
 */

export interface BracketSlotInput {
  matchId: string;
  /** 1 = first round … maxRound = final; 0 = play-in. */
  round: number;
  /** 1-indexed position within the round. */
  position: number;
}

export interface BranchUnit {
  kind: 'anchor' | 'converge';
  /** The spread-round node this sub-tree converges to; null for the converge unit. */
  anchor: { round: number; position: number } | null;
  /** Match ids ordered round ASC, then position ASC (earliest rounds first). */
  matchIds: string[];
}

export interface GroupBracketBranchesResult {
  units: BranchUnit[];
  spreadRound: number;
  /** Defensive — slots that couldn't be assigned (expected empty). */
  orphans: string[];
}

function ordered(slots: BracketSlotInput[]): string[] {
  return [...slots]
    .sort((a, b) => (a.round !== b.round ? a.round - b.round : a.position - b.position))
    .map((s) => s.matchId);
}

export interface GroupBracketBranchesOptions {
  /** Double-elim round split from `phases.config_json`. Omit for single-elim. */
  wbRounds?: number | null;
  lbRounds?: number | null;
}

export function groupBracketBranches(
  slots: BracketSlotInput[],
  liceCount: number,
  options: GroupBracketBranchesOptions = {},
): GroupBracketBranchesResult {
  const { wbRounds, lbRounds } = options;
  const isDoubleElim =
    typeof wbRounds === 'number' && wbRounds > 0 && typeof lbRounds === 'number' && lbRounds >= 0;

  if (!isDoubleElim) return spreadBranches(slots, liceCount);

  // Spread the winners bracket only; everything downstream of it (losers
  // bracket, grand final, reset) converges in round order.
  const wb = spreadBranches(
    slots.filter((s) => s.round <= wbRounds),
    liceCount,
  );
  const downstream = slots.filter((s) => s.round > wbRounds);
  const convergeIds = [
    ...(wb.units.find((u) => u.kind === 'converge')?.matchIds ?? []),
    ...ordered(downstream),
  ];

  const units = wb.units.filter((u) => u.kind === 'anchor');
  if (convergeIds.length > 0) {
    units.push({ kind: 'converge', anchor: null, matchIds: convergeIds });
  }
  return { units, spreadRound: wb.spreadRound, orphans: [] };
}

function spreadBranches(slots: BracketSlotInput[], liceCount: number): GroupBracketBranchesResult {
  if (slots.length === 0) return { units: [], spreadRound: 0, orphans: [] };

  const rounds = slots.map((s) => s.round);
  const maxRound = Math.max(...rounds);
  const distinctRounds = new Set(rounds).size;

  // One lice, or a single round (e.g. only the final): everything converges.
  if (liceCount <= 1 || distinctRounds <= 1) {
    return {
      units: [{ kind: 'converge', anchor: null, matchIds: ordered(slots) }],
      spreadRound: Math.max(1, Math.min(...rounds.filter((r) => r >= 1), maxRound)),
      orphans: [],
    };
  }

  const spreadRound = Math.max(1, maxRound - Math.floor(Math.log2(liceCount)));

  // Bucket each slot: above the spread round → converge; at/below → anchor p.
  const anchorBuckets = new Map<number, BracketSlotInput[]>();
  const convergeSlots: BracketSlotInput[] = [];
  for (const s of slots) {
    if (s.round > spreadRound) {
      convergeSlots.push(s);
      continue;
    }
    const p = Math.ceil(s.position / 2 ** (spreadRound - s.round));
    const arr = anchorBuckets.get(p) ?? [];
    arr.push(s);
    anchorBuckets.set(p, arr);
  }

  const units: BranchUnit[] = [];
  for (const p of [...anchorBuckets.keys()].sort((a, b) => a - b)) {
    units.push({
      kind: 'anchor',
      anchor: { round: spreadRound, position: p },
      matchIds: ordered(anchorBuckets.get(p)!),
    });
  }
  if (convergeSlots.length > 0) {
    units.push({ kind: 'converge', anchor: null, matchIds: ordered(convergeSlots) });
  }

  return { units, spreadRound, orphans: [] };
}
