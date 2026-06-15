import { describe, expect, it } from 'vitest';
import { computePoolReschedule } from './pool-reschedule';

describe('computePoolReschedule', () => {
  it('moves all matches to the target lice and shifts times, preserving internal spacing', () => {
    const updates = computePoolReschedule(
      [
        { id: 'a', scheduledAt: '2027-06-21T11:00:00.000Z' },
        { id: 'b', scheduledAt: '2027-06-21T11:10:00.000Z' },
      ],
      'lice-3',
      '2027-06-21T14:00:00.000Z',
    );
    expect(updates).toEqual([
      { matchId: 'a', liceId: 'lice-3', scheduledAt: '2027-06-21T14:00:00.000Z' },
      { matchId: 'b', liceId: 'lice-3', scheduledAt: '2027-06-21T14:10:00.000Z' },
    ]);
  });

  it('changes lice only (times unchanged) when the target start equals the current earliest', () => {
    const updates = computePoolReschedule(
      [
        { id: 'a', scheduledAt: '2027-06-21T11:00:00.000Z' },
        { id: 'b', scheduledAt: '2027-06-21T11:10:00.000Z' },
      ],
      'lice-2',
      '2027-06-21T11:00:00.000Z',
    );
    expect(updates).toEqual([
      { matchId: 'a', liceId: 'lice-2', scheduledAt: '2027-06-21T11:00:00.000Z' },
      { matchId: 'b', liceId: 'lice-2', scheduledAt: '2027-06-21T11:10:00.000Z' },
    ]);
  });

  it('leaves a null-time match unscheduled while a timed sibling shifts, and applies the lice to both', () => {
    const updates = computePoolReschedule(
      [
        { id: 'a', scheduledAt: null },
        { id: 'b', scheduledAt: '2027-06-21T11:00:00.000Z' },
      ],
      'lice-1',
      '2027-06-21T15:30:00.000Z',
    );
    expect(updates).toEqual([
      { matchId: 'a', liceId: 'lice-1', scheduledAt: null },
      { matchId: 'b', liceId: 'lice-1', scheduledAt: '2027-06-21T15:30:00.000Z' },
    ]);
  });

  it('with no timed match, only sets the lice (all times stay null)', () => {
    const updates = computePoolReschedule(
      [
        { id: 'a', scheduledAt: null },
        { id: 'b', scheduledAt: null },
      ],
      'lice-4',
      '2027-06-21T14:00:00.000Z',
    );
    expect(updates).toEqual([
      { matchId: 'a', liceId: 'lice-4', scheduledAt: null },
      { matchId: 'b', liceId: 'lice-4', scheduledAt: null },
    ]);
  });

  it('clears the lice when the target lice is null', () => {
    const updates = computePoolReschedule(
      [{ id: 'a', scheduledAt: '2027-06-21T11:00:00.000Z' }],
      null,
      '2027-06-21T11:00:00.000Z',
    );
    expect(updates).toEqual([
      { matchId: 'a', liceId: null, scheduledAt: '2027-06-21T11:00:00.000Z' },
    ]);
  });
});
