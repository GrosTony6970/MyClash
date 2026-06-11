import { describe, expect, it } from 'vitest';
import { computeBracketEdges } from './compute-bracket-edges';
import type { BracketSlotData } from './types';

function makeSlots(rounds: Array<{ round: number; count: number }>): BracketSlotData[] {
  const out: BracketSlotData[] = [];
  for (const { round, count } of rounds) {
    for (let i = 0; i < count; i++) {
      out.push({
        id: `r${round}p${i + 1}`,
        round,
        position: i + 1,
        redFighterName: null,
        blueFighterName: null,
        redScore: null,
        blueScore: null,
        status: 'pending',
        matchId: null,
      });
    }
  }
  return out;
}

function mk(
  id: string,
  round: number,
  position: number,
  refs?: { a?: string; b?: string },
): BracketSlotData {
  return {
    id,
    round,
    position,
    redFighterName: null,
    blueFighterName: null,
    redScore: null,
    blueScore: null,
    status: 'pending',
    matchId: null,
    source_a_ref: refs?.a ?? null,
    source_b_ref: refs?.b ?? null,
  };
}

describe('computeBracketEdges', () => {
  it('16-fighter R1 → R2 pairs (1,2)→r2p1, (3,4)→r2p2, (5,6)→r2p3, (7,8)→r2p4', () => {
    const slots = makeSlots([
      { round: 1, count: 8 },
      { round: 2, count: 4 },
    ]);
    const edges = computeBracketEdges(slots, [1, 2]);

    expect(edges).toHaveLength(8);
    const groupedByTarget = new Map<string, string[]>();
    for (const e of edges) {
      const arr = groupedByTarget.get(e.to) ?? [];
      arr.push(e.from);
      groupedByTarget.set(e.to, arr);
    }
    expect(groupedByTarget.get('r2p1')?.sort()).toEqual(['r1p1', 'r1p2']);
    expect(groupedByTarget.get('r2p2')?.sort()).toEqual(['r1p3', 'r1p4']);
    expect(groupedByTarget.get('r2p3')?.sort()).toEqual(['r1p5', 'r1p6']);
    expect(groupedByTarget.get('r2p4')?.sort()).toEqual(['r1p7', 'r1p8']);
  });

  it('the last slot of every round has an outgoing edge — regression guard for the prior orphan bug', () => {
    // Prior buggy formula `Math.floor(pos / 2)` produced
    // floor(8/2)=4 → toSlots[4] which is undefined for a 4-slot
    // second round, so the last slot dropped off the end.
    const slots = makeSlots([
      { round: 1, count: 8 },
      { round: 2, count: 4 },
    ]);
    const edges = computeBracketEdges(slots, [1, 2]);
    expect(edges.some((e) => e.from === 'r1p8')).toBe(true);
  });

  it('8-fighter R8 → SF → F: 4→2→1, every slot connected', () => {
    const slots = makeSlots([
      { round: 1, count: 4 },
      { round: 2, count: 2 },
      { round: 3, count: 1 },
    ]);
    const edges = computeBracketEdges(slots, [1, 2, 3]);

    expect(edges).toHaveLength(6); // 4 R1→SF + 2 SF→F
    const r1Edges = edges.filter((e) => e.from.startsWith('r1'));
    expect(r1Edges.find((e) => e.from === 'r1p1')?.to).toBe('r2p1');
    expect(r1Edges.find((e) => e.from === 'r1p2')?.to).toBe('r2p1');
    expect(r1Edges.find((e) => e.from === 'r1p3')?.to).toBe('r2p2');
    expect(r1Edges.find((e) => e.from === 'r1p4')?.to).toBe('r2p2');
    expect(
      edges
        .filter((e) => e.to === 'r3p1')
        .map((e) => e.from)
        .sort(),
    ).toEqual(['r2p1', 'r2p2']);
  });

  it('32-fighter R32 → R16 → QF → SF → F: 16→8→4→2→1, every slot connected', () => {
    const slots = makeSlots([
      { round: 1, count: 16 },
      { round: 2, count: 8 },
      { round: 3, count: 4 },
      { round: 4, count: 2 },
      { round: 5, count: 1 },
    ]);
    const edges = computeBracketEdges(slots, [1, 2, 3, 4, 5]);

    expect(edges).toHaveLength(30); // 16 + 8 + 4 + 2
    // Last slot of each round must have an edge — prior bug
    // orphaned them.
    expect(edges.some((e) => e.from === 'r1p16')).toBe(true);
    expect(edges.some((e) => e.from === 'r2p8')).toBe(true);
    expect(edges.some((e) => e.from === 'r3p4')).toBe(true);
    expect(edges.some((e) => e.from === 'r4p2')).toBe(true);
  });

  it('double-elim winners-bracket lane pairs within-lane with the same semantic', () => {
    // Operator passes only the WB slots; the helper doesn't know
    // anything about WB vs LB — same pairing math applies.
    const wbSlots = makeSlots([
      { round: 1, count: 4 },
      { round: 2, count: 2 },
      { round: 3, count: 1 },
    ]);
    const edges = computeBracketEdges(wbSlots, [1, 2, 3]);
    expect(edges).toHaveLength(6);
    expect(
      edges
        .filter((e) => e.to === 'r2p1')
        .map((e) => e.from)
        .sort(),
    ).toEqual(['r1p1', 'r1p2']);
    expect(
      edges
        .filter((e) => e.to === 'r2p2')
        .map((e) => e.from)
        .sort(),
    ).toEqual(['r1p3', 'r1p4']);
  });

  it('uses winner-of refs to pair a play-in round to its real R1 slots (single-elim)', () => {
    // 18-fighter shape: 2 play-ins feed two *different* R1 matches.
    // Position-pairing (floor((pos-1)/2)) would wrongly map both
    // play-ins to r1p1; the generator refs say otherwise.
    const slots: BracketSlotData[] = [
      mk('r0p1', 0, 1),
      mk('r0p2', 0, 2),
      mk('r1p1', 1, 1, { a: 'seed 1', b: 'winner of R0P2' }),
      mk('r1p2', 1, 2, { a: 'seed 9', b: 'seed 8' }),
      mk('r1p3', 1, 3),
      mk('r1p4', 1, 4),
      mk('r1p5', 1, 5),
      mk('r1p6', 1, 6),
      mk('r1p7', 1, 7),
      mk('r1p8', 1, 8, { a: 'seed 2', b: 'winner of R0P1' }),
    ];

    const edges = computeBracketEdges(slots, [0, 1]);

    // Each play-in points at the R1 match it actually feeds.
    expect(edges).toContainEqual({ from: 'r0p2', to: 'r1p1', kind: 'winner' });
    expect(edges).toContainEqual({ from: 'r0p1', to: 'r1p8', kind: 'winner' });
    // And NOT the position-paired bug (both → r1p1).
    expect(edges.filter((e) => e.to === 'r1p1')).toHaveLength(1);
    expect(edges.some((e) => e.from === 'r0p1' && e.to === 'r1p1')).toBe(false);
  });

  it('every connector targets a real toSlots entry — never undefined', () => {
    const slots = makeSlots([
      { round: 1, count: 8 },
      { round: 2, count: 4 },
    ]);
    const edges = computeBracketEdges(slots, [1, 2]);
    const slotIds = new Set(slots.map((s) => s.id));
    for (const edge of edges) {
      expect(slotIds.has(edge.from)).toBe(true);
      expect(slotIds.has(edge.to)).toBe(true);
    }
  });
});
