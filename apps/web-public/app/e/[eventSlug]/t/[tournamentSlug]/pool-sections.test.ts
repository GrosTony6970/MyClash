import { describe, it, expect } from 'vitest';
import { groupPoolsByStart } from './pool-sections';

type P = { id: string; startAt: string | null };

describe('groupPoolsByStart', () => {
  it('returns [] for no pools', () => {
    expect(groupPoolsByStart<P>([])).toEqual([]);
  });

  it('puts pools with distinct start times in separate, chronologically-sorted sections', () => {
    const pools: P[] = [
      { id: 'b', startAt: '2026-06-14T13:30:00Z' },
      { id: 'a', startAt: '2026-06-14T11:00:00Z' },
    ];
    const sections = groupPoolsByStart(pools);
    expect(sections.map((s) => s.startAt)).toEqual([
      '2026-06-14T11:00:00Z',
      '2026-06-14T13:30:00Z',
    ]);
    expect(sections[0]!.pools.map((p) => p.id)).toEqual(['a']);
    expect(sections[1]!.pools.map((p) => p.id)).toEqual(['b']);
  });

  it('groups pools sharing a start time into one section, preserving input order', () => {
    const pools: P[] = [
      { id: 'p1', startAt: '2026-06-14T11:00:00Z' },
      { id: 'p2', startAt: '2026-06-14T11:00:00Z' },
    ];
    const sections = groupPoolsByStart(pools);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.pools.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('collects null-start pools into a trailing section after the scheduled ones', () => {
    const pools: P[] = [
      { id: 'tbd', startAt: null },
      { id: 'a', startAt: '2026-06-14T11:00:00Z' },
    ];
    const sections = groupPoolsByStart(pools);
    expect(sections.map((s) => s.startAt)).toEqual(['2026-06-14T11:00:00Z', null]);
    expect(sections[1]!.pools.map((p) => p.id)).toEqual(['tbd']);
  });
});
