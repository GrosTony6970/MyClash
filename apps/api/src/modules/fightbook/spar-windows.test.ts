import { describe, expect, it } from 'vitest';
import { sparWindows } from './spar-windows';

// An Event spar on Saturday 23 May 2026 in Paris: the day ends Sunday 06:00 Paris (04:00Z).
const PARIS_ROW = {
  spar_day: '2026-05-23',
  zone: 'Europe/Paris',
  expires_at: '2026-05-24T04:00:00+00:00',
};
const SATURDAY_MIDNIGHT = new Date('2026-05-22T22:00:00Z');

describe('sparWindows', () => {
  it('opens at the Event day start, cancels until the day ends, marks two days longer', () => {
    expect(sparWindows(PARIS_ROW)).toEqual({
      markFrom: SATURDAY_MIDNIGHT,
      cancelUntil: new Date('2026-05-24T04:00:00Z'),
      markUntil: new Date('2026-05-26T04:00:00Z'),
    });
  });

  it('opens a free-date spar at the midnight of its own place, not the asker’s', () => {
    const montreal = { ...PARIS_ROW, zone: 'America/Montreal' };
    expect(sparWindows(montreal).markFrom).toEqual(new Date('2026-05-23T04:00:00Z'));
    expect(sparWindows(montreal).markFrom).not.toEqual(SATURDAY_MIDNIGHT);
  });
});
