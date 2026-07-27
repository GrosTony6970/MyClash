import type { ConnectorEdge } from './BracketConnectors';
import type { BracketSlotData } from './types';

/**
 * Within-lane bracket pairing.
 *
 * Round-N slots (1-indexed positions: 1, 2, 3, …) pair off into
 * round-N+1 slots such that (pos 1, pos 2) → target 1,
 * (3, 4) → 2, (5, 6) → 3, …
 *
 * The destination index in the 0-indexed `toSlots` array is therefore
 * `Math.floor((pos - 1) / 2)`. A prior version used
 * `Math.floor(pos / 2)` which treats position as 0-indexed: it
 * mis-paired half the connectors AND orphaned the last slot of every
 * round (pos N where N is even ran off the end of `toSlots`).
 *
 * Pure: no React, no DOM. Used by both the single-elim layout and
 * each lane of the double-elim layout (winners + losers brackets).
 *
 * When the slots carry the generator's advancement refs
 * (`source_a_ref`/`source_b_ref` of the strict form `winner of RxPy`),
 * edges come straight from them — the authoritative bracket structure.
 * This is what makes a play-in round connect correctly: position-pairing
 * assumes each round is a clean halving of the next, which a play-in
 * round (e.g. R0=2 → R1=8) is not.
 *
 * Double-elim refs are WB/LB-prefixed, and LB refs number their rounds
 * RELATIVE to the losers bracket while the slots carry absolute rounds. Pass
 * `refPrefix` + `roundOffset` per lane so those refs resolve too; without them
 * a double-elim lane silently fell back to position-pairing and mis-drew the
 * play-in feed.
 */
export interface BracketEdgeOptions {
  /** Ref namespace for this lane: '' for single-elim, 'WB' / 'LB' per lane. */
  refPrefix?: '' | 'WB' | 'LB';
  /** Added to a ref's round number to reach the slot's ABSOLUTE round.
   *  Losers-bracket refs count from 1, so this is wbRounds for the LB lane. */
  roundOffset?: number;
}

export function computeBracketEdges(
  slots: BracketSlotData[],
  roundNumbers: readonly number[],
  options: BracketEdgeOptions = {},
): ConnectorEdge[] {
  const { refPrefix = '', roundOffset = 0 } = options;
  const winnerRef = new RegExp(`^winner of ${refPrefix}R(\\d+)P(\\d+)$`);
  // Prefer the generator's advancement refs when present — exact
  // structure, including the irregular play-in → first-round feeds.
  const idByRoundPos = new Map<string, string>();
  for (const s of slots) idByRoundPos.set(`${s.round}:${s.position}`, s.id);
  const refEdges: ConnectorEdge[] = [];
  let sawRef = false;
  for (const s of slots) {
    for (const ref of [s.source_a_ref, s.source_b_ref]) {
      const m = ref?.match(winnerRef);
      if (!m) continue;
      sawRef = true;
      const fromId = idByRoundPos.get(`${Number(m[1]) + roundOffset}:${Number(m[2])}`);
      if (fromId) refEdges.push({ from: fromId, to: s.id, kind: 'winner' });
    }
  }
  if (sawRef) return refEdges;

  const byRound = new Map<number, BracketSlotData[]>();
  for (const s of slots) {
    const arr = byRound.get(s.round) ?? [];
    arr.push(s);
    byRound.set(s.round, arr);
  }
  for (const arr of byRound.values()) arr.sort((a, b) => a.position - b.position);

  const out: ConnectorEdge[] = [];
  for (let i = 0; i < roundNumbers.length - 1; i++) {
    const fromSlots = byRound.get(roundNumbers[i]!) ?? [];
    const toSlots = byRound.get(roundNumbers[i + 1]!) ?? [];
    for (const fs of fromSlots) {
      const targetIdx = Math.floor((fs.position - 1) / 2);
      const ts = toSlots[targetIdx];
      if (ts) out.push({ from: fs.id, to: ts.id, kind: 'winner' });
    }
  }
  return out;
}
