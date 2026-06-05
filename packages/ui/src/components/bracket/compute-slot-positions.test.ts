import { describe, expect, it } from 'vitest';
import { computeSlotPositions } from './compute-slot-positions';
import type { ConnectorEdge } from './BracketConnectors';
import type { BracketSlotData } from './types';

const PITCH = 90;

function slot(id: string, round: number, position: number): BracketSlotData {
  return {
    id,
    round,
    position,
    redFighterName: null,
    blueFighterName: null,
    redScore: 0,
    blueScore: 0,
    status: 'pending',
    matchId: null,
  };
}

function byRound(slots: BracketSlotData[]): Map<number, BracketSlotData[]> {
  const m = new Map<number, BracketSlotData[]>();
  for (const s of slots) {
    const arr = m.get(s.round) ?? [];
    arr.push(s);
    m.set(s.round, arr);
  }
  for (const arr of m.values()) arr.sort((a, b) => a.position - b.position);
  return m;
}

describe('computeSlotPositions', () => {
  it('returns an empty map when no rounds are provided', () => {
    const result = computeSlotPositions(new Map(), [], [], PITCH);
    expect(result.positions.size).toBe(0);
  });

  it('lays out an 8-fighter power-of-2 bracket with parent-midpoint alignment', () => {
    // 4 QF -> 2 SF -> 1 F. QF at uniform pitch; each SF at midpoint
    // of its QF pair; F at midpoint of SF pair.
    const slots = [
      slot('qf1', 1, 1),
      slot('qf2', 1, 2),
      slot('qf3', 1, 3),
      slot('qf4', 1, 4),
      slot('sf1', 2, 1),
      slot('sf2', 2, 2),
      slot('f1', 3, 1),
    ];
    const edges: ConnectorEdge[] = [
      { from: 'qf1', to: 'sf1', kind: 'winner' },
      { from: 'qf2', to: 'sf1', kind: 'winner' },
      { from: 'qf3', to: 'sf2', kind: 'winner' },
      { from: 'qf4', to: 'sf2', kind: 'winner' },
      { from: 'sf1', to: 'f1', kind: 'winner' },
      { from: 'sf2', to: 'f1', kind: 'winner' },
    ];

    const { positions, columnHeight } = computeSlotPositions(
      byRound(slots),
      [1, 2, 3],
      edges,
      PITCH,
    );

    expect(columnHeight).toBe(4 * PITCH);
    // QF: uniform pitch at i + 0.5.
    expect(positions.get('qf1')).toBe(0.5 * PITCH);
    expect(positions.get('qf2')).toBe(1.5 * PITCH);
    expect(positions.get('qf3')).toBe(2.5 * PITCH);
    expect(positions.get('qf4')).toBe(3.5 * PITCH);
    // SF: midpoint of parent pair.
    expect(positions.get('sf1')).toBe(PITCH);
    expect(positions.get('sf2')).toBe(3 * PITCH);
    // F: midpoint of SF pair (= column center for a power-of-2 bracket).
    expect(positions.get('f1')).toBe(2 * PITCH);
  });

  it('aligns each QF at the midpoint of its parent play-in pair (14-fighter bracket)', () => {
    // 7 play-ins -> 4 QF. (PI1,PI2) -> QF1, (PI3,PI4) -> QF2,
    // (PI5,PI6) -> QF3, PI7-only -> QF4.
    const slots = [
      slot('pi1', 0, 1),
      slot('pi2', 0, 2),
      slot('pi3', 0, 3),
      slot('pi4', 0, 4),
      slot('pi5', 0, 5),
      slot('pi6', 0, 6),
      slot('pi7', 0, 7),
      slot('qf1', 1, 1),
      slot('qf2', 1, 2),
      slot('qf3', 1, 3),
      slot('qf4', 1, 4),
    ];
    const edges: ConnectorEdge[] = [
      { from: 'pi1', to: 'qf1', kind: 'winner' },
      { from: 'pi2', to: 'qf1', kind: 'winner' },
      { from: 'pi3', to: 'qf2', kind: 'winner' },
      { from: 'pi4', to: 'qf2', kind: 'winner' },
      { from: 'pi5', to: 'qf3', kind: 'winner' },
      { from: 'pi6', to: 'qf3', kind: 'winner' },
      { from: 'pi7', to: 'qf4', kind: 'winner' },
    ];

    const { positions } = computeSlotPositions(byRound(slots), [0, 1], edges, PITCH);

    // QF1 sits at midpoint(PI1=45, PI2=135) = 90.
    expect(positions.get('qf1')).toBe(PITCH);
    // QF2 at midpoint(PI3=225, PI4=315) = 270.
    expect(positions.get('qf2')).toBe(3 * PITCH);
    // QF3 at midpoint(PI5=405, PI6=495) = 450.
    expect(positions.get('qf3')).toBe(5 * PITCH);
    // QF4 has only PI7 as parent -> aligns vertically with PI7 (= 6.5 * PITCH).
    expect(positions.get('qf4')).toBe(6.5 * PITCH);
  });

  it('distributes orphan slots evenly when a round has no parent edges', () => {
    // Round 2 has no slot with edges from round 1 — uniform fallback.
    const slots = [slot('r1a', 1, 1), slot('r1b', 1, 2), slot('r2a', 2, 1), slot('r2b', 2, 2)];
    const edges: ConnectorEdge[] = [];

    const { positions, columnHeight } = computeSlotPositions(byRound(slots), [1, 2], edges, PITCH);

    // Orphans share the column height evenly (= columnHeight / N each).
    const span = columnHeight / 2;
    expect(positions.get('r2a')).toBe(0.5 * span);
    expect(positions.get('r2b')).toBe(1.5 * span);
  });

  it('ignores bronze-edge contributions when computing midpoints', () => {
    // A bronze edge from SF -> bronze match should NOT contribute
    // to the bronze match's parent-midpoint placement here (bronze
    // is laid out separately in the renderer). The orphan fallback
    // catches it.
    const slots = [slot('sf1', 2, 1), slot('sf2', 2, 2), slot('bronze', 3, 99)];
    const edges: ConnectorEdge[] = [
      { from: 'sf1', to: 'bronze', kind: 'bronze' },
      { from: 'sf2', to: 'bronze', kind: 'bronze' },
    ];

    const { positions, columnHeight } = computeSlotPositions(byRound(slots), [2, 3], edges, PITCH);

    // Bronze is the only slot in round 3 → orphan fallback gives
    // it the column midpoint.
    expect(positions.get('bronze')).toBe(columnHeight / 2);
  });
});
