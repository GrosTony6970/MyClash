import { describe, expect, it } from 'vitest';
import { cascadeBlockShift } from './block-cascade';

const blocks = [
  { id: 'reg', startMin: 480, endMin: 540 }, // 08:00–09:00
  { id: 'ref', startMin: 540, endMin: 570 }, // 09:00–09:30
  { id: 'pool', startMin: 570, endMin: 720 }, // 09:30–12:00
];

describe('cascadeBlockShift', () => {
  it('pushes the moved block and every later block forward by Δ', () => {
    // Drag "ref" (09:00) forward 30 min. ref + pool shift; reg stays.
    expect(cascadeBlockShift(blocks, 'ref', 30)).toEqual([
      { id: 'ref', startMin: 570, endMin: 600 },
      { id: 'pool', startMin: 600, endMin: 750 },
    ]);
  });

  it('pulls later blocks earlier on a backward move, clamped at day start', () => {
    // Drag "reg" (08:00) back 600 min → would be -120; clamps to 0 but keeps
    // its duration. Later blocks shift by the same raw Δ, also clamped.
    const out = cascadeBlockShift(blocks, 'reg', -600, 0);
    expect(out[0]).toEqual({ id: 'reg', startMin: 0, endMin: 60 });
  });

  it('leaves earlier blocks untouched', () => {
    const out = cascadeBlockShift(blocks, 'pool', 60);
    expect(out.map((b) => b.id)).toEqual(['pool']);
  });

  it('returns nothing for a no-op move or unknown block', () => {
    expect(cascadeBlockShift(blocks, 'ref', 0)).toEqual([]);
    expect(cascadeBlockShift(blocks, 'nope', 30)).toEqual([]);
  });
});
