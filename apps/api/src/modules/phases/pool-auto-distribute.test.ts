import { describe, expect, it } from 'vitest';
import { distributePoolMatches, rotateLicesFrom } from './pool-auto-distribute';

describe('distributePoolMatches', () => {
  it('fans 8 matches across 4 parallel lices with 5-minute steps', () => {
    const assignments = distributePoolMatches({
      matchIds: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'],
      liceIds: ['lA', 'lB', 'lC', 'lD'],
      startAtIso: '2026-06-01T09:00:00.000Z',
      durationMinutes: 5,
    });

    expect(assignments).toEqual([
      { matchId: 'm1', liceId: 'lA', scheduledAt: '2026-06-01T09:00:00.000Z' },
      { matchId: 'm2', liceId: 'lB', scheduledAt: '2026-06-01T09:00:00.000Z' },
      { matchId: 'm3', liceId: 'lC', scheduledAt: '2026-06-01T09:00:00.000Z' },
      { matchId: 'm4', liceId: 'lD', scheduledAt: '2026-06-01T09:00:00.000Z' },
      { matchId: 'm5', liceId: 'lA', scheduledAt: '2026-06-01T09:05:00.000Z' },
      { matchId: 'm6', liceId: 'lB', scheduledAt: '2026-06-01T09:05:00.000Z' },
      { matchId: 'm7', liceId: 'lC', scheduledAt: '2026-06-01T09:05:00.000Z' },
      { matchId: 'm8', liceId: 'lD', scheduledAt: '2026-06-01T09:05:00.000Z' },
    ]);
  });

  it('uses a single lice when only one is provided', () => {
    const assignments = distributePoolMatches({
      matchIds: ['m1', 'm2', 'm3'],
      liceIds: ['onlyOne'],
      startAtIso: '2026-06-01T10:00:00.000Z',
      durationMinutes: 10,
    });

    expect(assignments.map((a) => a.liceId)).toEqual(['onlyOne', 'onlyOne', 'onlyOne']);
    expect(assignments.map((a) => a.scheduledAt)).toEqual([
      '2026-06-01T10:00:00.000Z',
      '2026-06-01T10:10:00.000Z',
      '2026-06-01T10:20:00.000Z',
    ]);
  });

  it('rejects an empty lice list', () => {
    expect(() =>
      distributePoolMatches({
        matchIds: ['m1'],
        liceIds: [],
        startAtIso: '2026-06-01T09:00:00.000Z',
        durationMinutes: 5,
      }),
    ).toThrow(/lice/i);
  });

  it('rejects a non-positive duration', () => {
    expect(() =>
      distributePoolMatches({
        matchIds: ['m1'],
        liceIds: ['lA'],
        startAtIso: '2026-06-01T09:00:00.000Z',
        durationMinutes: 0,
      }),
    ).toThrow(/duration/i);
  });
});

describe('rotateLicesFrom', () => {
  it('rotates the lice list so it starts at the chosen lice', () => {
    expect(rotateLicesFrom(['lA', 'lB', 'lC', 'lD'], 'lC')).toEqual(['lC', 'lD', 'lA', 'lB']);
  });

  it('returns the list untouched when start is null', () => {
    expect(rotateLicesFrom(['lA', 'lB', 'lC'], null)).toEqual(['lA', 'lB', 'lC']);
  });

  it('returns the list untouched when start is not in the list', () => {
    expect(rotateLicesFrom(['lA', 'lB', 'lC'], 'nope')).toEqual(['lA', 'lB', 'lC']);
  });

  it('returns the list untouched when start is already the first lice', () => {
    expect(rotateLicesFrom(['lA', 'lB', 'lC'], 'lA')).toEqual(['lA', 'lB', 'lC']);
  });
});
