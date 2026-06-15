import { describe, expect, it } from 'vitest';
import { computeLiceDrift, type DriftMatch } from './lice-drift';

function m(over: Partial<DriftMatch>): DriftMatch {
  return {
    liceId: 'L1',
    scheduledAt: '2027-06-21T11:00:00.000Z',
    startedAt: null,
    endedAt: null,
    status: 'scheduled',
    durationMinutes: 5,
    matchNumberLabel: 'M1',
    ...over,
  };
}

describe('computeLiceDrift', () => {
  it('reports how late the currently-running match started', () => {
    const d = computeLiceDrift([
      m({ status: 'running', startedAt: '2027-06-21T11:25:00.000Z', matchNumberLabel: 'M3' }),
    ]);
    expect(d.get('L1')).toEqual({ driftMin: 25, basisLabel: 'M3' });
  });

  it('falls back to the last completed match finishing vs its planned end', () => {
    // scheduled 11:00, 5-min slot → planned end 11:05; actually ended 11:20 → 15 late.
    const d = computeLiceDrift([
      m({ status: 'completed', endedAt: '2027-06-21T11:20:00.000Z', matchNumberLabel: 'M2' }),
    ]);
    expect(d.get('L1')).toEqual({ driftMin: 15, basisLabel: 'M2' });
  });

  it('reports a negative drift when ahead of schedule', () => {
    const d = computeLiceDrift([m({ status: 'completed', endedAt: '2027-06-21T10:55:00.000Z' })]);
    expect(d.get('L1')?.driftMin).toBe(-10); // planned end 11:05, ended 10:55
  });

  it('prefers the running match over earlier completed ones, and the latest of each', () => {
    const d = computeLiceDrift([
      m({ status: 'completed', endedAt: '2027-06-21T11:05:00.000Z', matchNumberLabel: 'M1' }),
      m({
        scheduledAt: '2027-06-21T11:05:00.000Z',
        status: 'running',
        startedAt: '2027-06-21T11:18:00.000Z',
        matchNumberLabel: 'M2',
      }),
    ]);
    expect(d.get('L1')).toEqual({ driftMin: 13, basisLabel: 'M2' });
  });

  it('omits lices with nothing started yet', () => {
    const d = computeLiceDrift([m({ status: 'scheduled' })]);
    expect(d.has('L1')).toBe(false);
  });

  it('tracks lices independently', () => {
    const d = computeLiceDrift([
      m({ liceId: 'L1', status: 'running', startedAt: '2027-06-21T11:10:00.000Z' }),
      m({ liceId: 'L2', status: 'scheduled' }),
    ]);
    expect(d.get('L1')?.driftMin).toBe(10);
    expect(d.has('L2')).toBe(false);
  });
});
