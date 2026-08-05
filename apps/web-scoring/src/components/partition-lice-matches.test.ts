import { describe, expect, it } from 'vitest';
import { isLiveStatus, partitionLiceMatches } from './partition-lice-matches';

const m = (id: string, status: string) => ({ id, status });

describe('isLiveStatus', () => {
  // The truth table now lives with the predicate, in
  // packages/types/src/match-status.test.ts. This only guards the
  // re-export the pad's call sites still import from here.
  it('is re-exported from this module', () => {
    expect(isLiveStatus('paused')).toBe(true);
    expect(isLiveStatus('scheduled')).toBe(false);
  });
});

describe('partitionLiceMatches', () => {
  it('reports nothing live when the only bout is merely scheduled', () => {
    // The regression: the old payload fell back to the first queued match, so
    // this rendered under a "LIVE" heading and pulsed a LIVE pill on the picker.
    const result = partitionLiceMatches([m('m1', 'scheduled')]);
    expect(result.live).toEqual([]);
    expect(result.next).toHaveLength(1);
  });

  it('treats paused as live — the bout is still on the piste', () => {
    expect(partitionLiceMatches([m('m1', 'paused')]).live.map((x) => x.id)).toEqual(['m1']);
  });

  it('surfaces both bouts when two are running at once', () => {
    // An operator forgot to end one. Showing both is how they find out.
    const result = partitionLiceMatches([m('m1', 'running'), m('m2', 'running')]);
    expect(result.live.map((x) => x.id)).toEqual(['m1', 'm2']);
  });

  it('never puts a completed or running bout in next', () => {
    const result = partitionLiceMatches([
      m('done', 'completed'),
      m('live', 'running'),
      m('soon', 'scheduled'),
    ]);
    expect(result.next.map((x) => x.id)).toEqual(['soon']);
  });

  it('caps next at the preview count but keeps all of them in all', () => {
    const many = Array.from({ length: 9 }, (_, i) => m(`m${i}`, 'scheduled'));
    const result = partitionLiceMatches(many);
    expect(result.next).toHaveLength(5);
    expect(result.all).toHaveLength(9);
  });

  it('preserves the incoming schedule order in all', () => {
    const rows = [m('a', 'completed'), m('b', 'running'), m('c', 'scheduled')];
    expect(partitionLiceMatches(rows).all.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('handles an empty list without throwing', () => {
    expect(partitionLiceMatches([])).toEqual({ live: [], next: [], all: [] });
  });
});
