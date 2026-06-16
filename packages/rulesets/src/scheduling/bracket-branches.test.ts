import { describe, expect, it } from 'vitest';
import { groupBracketBranches, type BracketSlotInput } from './bracket-branches';

/** Slots for a full single-elim bracket of `size`, ids "R{r}P{p}". */
function slotsForBracket(size: number): BracketSlotInput[] {
  const rounds = Math.log2(size);
  const out: BracketSlotInput[] = [];
  for (let r = 1; r <= rounds; r++) {
    const count = size / 2 ** r;
    for (let p = 1; p <= count; p++) out.push({ matchId: `R${r}P${p}`, round: r, position: p });
  }
  return out;
}

function allIds(units: ReturnType<typeof groupBracketBranches>['units']): string[] {
  return units.flatMap((u) => u.matchIds);
}

describe('groupBracketBranches', () => {
  it('groups a 32-bracket on 4 lices into 4 anchor sub-trees + a converge unit', () => {
    const res = groupBracketBranches(slotsForBracket(32), 4);
    expect(res.spreadRound).toBe(3);
    const anchors = res.units.filter((u) => u.kind === 'anchor');
    const converge = res.units.filter((u) => u.kind === 'converge');
    expect(anchors).toHaveLength(4);
    for (const a of anchors) expect(a.matchIds).toHaveLength(7); // 4×R1 + 2×R2 + 1×R3
    expect(converge).toHaveLength(1);
    expect(converge[0]!.matchIds).toEqual(['R4P1', 'R4P2', 'R5P1']); // 2 SF + final
  });

  it('orders each anchor sub-tree earliest round first', () => {
    const res = groupBracketBranches(slotsForBracket(32), 4);
    const a1 = res.units.find((u) => u.anchor?.position === 1)!;
    expect(a1.matchIds).toEqual(['R1P1', 'R1P2', 'R1P3', 'R1P4', 'R2P1', 'R2P2', 'R3P1']);
  });

  it('spreads an 8-bracket at round 1 on 4 lices', () => {
    const res = groupBracketBranches(slotsForBracket(8), 4);
    expect(res.spreadRound).toBe(1);
    expect(res.units.filter((u) => u.kind === 'anchor')).toHaveLength(4);
    const converge = res.units.find((u) => u.kind === 'converge')!;
    expect(converge.matchIds).toEqual(['R2P1', 'R2P2', 'R3P1']);
  });

  it('spreads a 16-bracket at the semi-finals on 2 lices', () => {
    const res = groupBracketBranches(slotsForBracket(16), 2);
    expect(res.spreadRound).toBe(3);
    const anchors = res.units.filter((u) => u.kind === 'anchor');
    expect(anchors).toHaveLength(2);
    for (const a of anchors) expect(a.matchIds).toHaveLength(7);
    expect(res.units.find((u) => u.kind === 'converge')!.matchIds).toEqual(['R4P1']);
  });

  it('uses only as many anchors as the bracket has when lices exceed it', () => {
    const res = groupBracketBranches(slotsForBracket(4), 8);
    expect(res.spreadRound).toBe(1);
    expect(res.units.filter((u) => u.kind === 'anchor')).toHaveLength(2);
    expect(res.orphans).toEqual([]);
  });

  it('collapses everything onto one unit when there is a single lice', () => {
    const res = groupBracketBranches(slotsForBracket(8), 1);
    expect(res.units).toHaveLength(1);
    expect(res.units[0]!.kind).toBe('converge');
    expect(res.units[0]!.matchIds).toHaveLength(7);
  });

  it('handles byes (missing early matches) without orphaning survivors', () => {
    const survivors = slotsForBracket(8).filter(
      (s) => s.matchId !== 'R1P1' && s.matchId !== 'R1P3',
    );
    const res = groupBracketBranches(survivors, 2);
    expect(res.spreadRound).toBe(2);
    expect(res.orphans).toEqual([]);
    const placed = allIds(res.units).sort();
    expect(placed).toEqual(survivors.map((s) => s.matchId).sort());
  });

  it('folds round-0 play-ins into a branch', () => {
    const slots: BracketSlotInput[] = [
      { matchId: 'PI1', round: 0, position: 1 },
      { matchId: 'PI2', round: 0, position: 2 },
      ...slotsForBracket(16),
    ];
    const res = groupBracketBranches(slots, 4);
    expect(res.spreadRound).toBe(2);
    expect(allIds(res.units)).toContain('PI1');
    expect(allIds(res.units)).toContain('PI2');
    expect(res.orphans).toEqual([]);
  });

  it('returns an empty result for no slots', () => {
    expect(groupBracketBranches([], 4)).toEqual({ units: [], spreadRound: 0, orphans: [] });
  });
});
