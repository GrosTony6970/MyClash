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
 * Pure: no I/O. Single-elimination only (the caller gates double-elim out).
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

export function groupBracketBranches(
  slots: BracketSlotInput[],
  liceCount: number,
): GroupBracketBranchesResult {
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
