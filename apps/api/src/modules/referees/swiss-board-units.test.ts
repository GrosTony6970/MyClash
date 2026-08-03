import { describe, expect, it } from 'vitest';
import {
  groupSwissMatchesIntoUnits,
  registrationIdsByRound,
  type SwissUnitMatch,
  type SwissUnitRound,
} from './swiss-board-units';

const ROUNDS: SwissUnitRound[] = [
  { id: 'r1', phaseId: 'ph-1', roundNumber: 1 },
  { id: 'r2', phaseId: 'ph-1', roundNumber: 2 },
];

function match(overrides: Partial<SwissUnitMatch> & { id: string }): SwissUnitMatch {
  return {
    swissRoundId: 'r1',
    liceId: 'lice-a',
    scheduledAt: null,
    redRegistrationId: null,
    blueRegistrationId: null,
    ...overrides,
  };
}

describe('groupSwissMatchesIntoUnits', () => {
  it('emits one unit per (round × piste)', () => {
    const units = groupSwissMatchesIntoUnits(ROUNDS, [
      match({ id: 'm1', liceId: 'lice-a', scheduledAt: '2026-08-01T09:00:00.000Z' }),
      match({ id: 'm2', liceId: 'lice-a', scheduledAt: '2026-08-01T09:10:00.000Z' }),
      match({ id: 'm3', liceId: 'lice-b', scheduledAt: '2026-08-01T09:00:00.000Z' }),
      match({
        id: 'm4',
        swissRoundId: 'r2',
        liceId: 'lice-a',
        scheduledAt: '2026-08-01T10:00:00.000Z',
      }),
    ]);

    expect(units.map((u) => u.key)).toEqual([
      'swiss-r1-lice-a',
      'swiss-r1-lice-b',
      'swiss-r2-lice-a',
    ]);
    expect(units[0]!.matches.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(units[1]!.matches.map((m) => m.id)).toEqual(['m3']);
    expect(units[0]!.roundNumber).toBe(1);
    expect(units[2]!.roundNumber).toBe(2);
  });

  it('orders bouts within a unit by start time, then id', () => {
    const units = groupSwissMatchesIntoUnits(ROUNDS, [
      match({ id: 'm-late', scheduledAt: '2026-08-01T09:20:00.000Z' }),
      match({ id: 'm-early', scheduledAt: '2026-08-01T09:00:00.000Z' }),
      match({ id: 'm-b-tie', scheduledAt: '2026-08-01T09:10:00.000Z' }),
      match({ id: 'm-a-tie', scheduledAt: '2026-08-01T09:10:00.000Z' }),
    ]);

    expect(units[0]!.matches.map((m) => m.id)).toEqual(['m-early', 'm-a-tie', 'm-b-tie', 'm-late']);
  });

  it('collects unplaced bouts into one per-round unscheduled unit', () => {
    const units = groupSwissMatchesIntoUnits(ROUNDS, [
      match({ id: 'm1', liceId: null }),
      match({ id: 'm2', liceId: null }),
      match({ id: 'm3', swissRoundId: 'r2', liceId: null }),
    ]);

    expect(units.map((u) => u.key)).toEqual(['swiss-r1-unscheduled', 'swiss-r2-unscheduled']);
    expect(units[0]!.matches).toHaveLength(2);
    expect(units[0]!.liceId).toBeNull();
    expect(units[0]!.scheduledStart).toBeNull();
    expect(units[0]!.scheduledEnd).toBeNull();
  });

  it('derives start and end from the bouts, matching the pool run-end rule', () => {
    const units = groupSwissMatchesIntoUnits(ROUNDS, [
      match({ id: 'm1', scheduledAt: '2026-08-01T09:00:00.000Z' }),
      match({ id: 'm2', scheduledAt: '2026-08-01T09:10:00.000Z' }),
      match({ id: 'm3', scheduledAt: '2026-08-01T09:20:00.000Z' }),
    ]);

    expect(units[0]!.scheduledStart).toBe('2026-08-01T09:00:00.000Z');
    // last start + the median 10-minute gap
    expect(units[0]!.scheduledEnd).toBe('2026-08-01T09:30:00.000Z');
  });

  it('skips matches whose round is gone, rather than inventing a unit', () => {
    const units = groupSwissMatchesIntoUnits(ROUNDS, [
      match({ id: 'm1', swissRoundId: 'deleted-round' }),
      match({ id: 'm2' }),
    ]);

    expect(units).toHaveLength(1);
    expect(units[0]!.matches.map((m) => m.id)).toEqual(['m2']);
  });

  it('returns nothing for an empty phase', () => {
    expect(groupSwissMatchesIntoUnits([], [])).toEqual([]);
    expect(groupSwissMatchesIntoUnits(ROUNDS, [])).toEqual([]);
  });
});

describe('registrationIdsByRound', () => {
  it('unions both sides across every piste of a round', () => {
    const byRound = registrationIdsByRound([
      match({
        id: 'm1',
        liceId: 'lice-a',
        redRegistrationId: 'reg-1',
        blueRegistrationId: 'reg-2',
      }),
      match({
        id: 'm2',
        liceId: 'lice-b',
        redRegistrationId: 'reg-3',
        blueRegistrationId: 'reg-4',
      }),
      match({
        id: 'm3',
        swissRoundId: 'r2',
        redRegistrationId: 'reg-1',
        blueRegistrationId: 'reg-3',
      }),
    ]);

    // A fighter on piste B must still block reffing piste A of the same round.
    expect([...byRound.get('r1')!].sort()).toEqual(['reg-1', 'reg-2', 'reg-3', 'reg-4']);
    expect([...byRound.get('r2')!].sort()).toEqual(['reg-1', 'reg-3']);
  });

  it('ignores a bye (one side null)', () => {
    const byRound = registrationIdsByRound([
      match({ id: 'm1', redRegistrationId: 'reg-1', blueRegistrationId: null }),
    ]);
    expect([...byRound.get('r1')!]).toEqual(['reg-1']);
  });
});
