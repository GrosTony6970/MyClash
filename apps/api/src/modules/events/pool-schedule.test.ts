import { describe, it, expect } from 'vitest';
import { derivePoolSchedule, type PoolMatchTimeRow } from './pool-schedule';

const lice = (name: string, color: string) => ({ name, color_hex: color });

describe('derivePoolSchedule', () => {
  it('returns all null for a pool with no matches', () => {
    expect(derivePoolSchedule([])).toEqual({
      liceName: null,
      liceColorHex: null,
      startAt: null,
    });
  });

  it('uses the earliest scheduled match for startAt + its lice', () => {
    const matches: PoolMatchTimeRow[] = [
      { scheduled_at: '2026-06-14T13:30:00Z', lices: lice('Piste 3', '#0f0') },
      { scheduled_at: '2026-06-14T11:00:00Z', lices: lice('Piste 2', '#f0f') },
    ];
    expect(derivePoolSchedule(matches)).toEqual({
      liceName: 'Piste 2',
      liceColorHex: '#f0f',
      startAt: '2026-06-14T11:00:00Z',
    });
  });

  it('ignores matches with a null scheduled_at when picking the start', () => {
    const matches: PoolMatchTimeRow[] = [
      { scheduled_at: null, lices: lice('Piste 9', '#999') },
      { scheduled_at: '2026-06-14T11:00:00Z', lices: lice('Piste 2', '#f0f') },
    ];
    const out = derivePoolSchedule(matches);
    expect(out.startAt).toBe('2026-06-14T11:00:00Z');
    expect(out.liceName).toBe('Piste 2');
  });

  it('falls back to the first match that has a lice when the earliest has none', () => {
    const matches: PoolMatchTimeRow[] = [
      { scheduled_at: '2026-06-14T11:00:00Z', lices: null },
      { scheduled_at: '2026-06-14T12:00:00Z', lices: lice('Piste 5', '#abc') },
    ];
    const out = derivePoolSchedule(matches);
    expect(out.startAt).toBe('2026-06-14T11:00:00Z');
    expect(out.liceName).toBe('Piste 5');
    expect(out.liceColorHex).toBe('#abc');
  });
});
