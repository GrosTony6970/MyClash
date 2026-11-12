import { describe, expect, it } from 'vitest';
import { lastFunctionBody } from '../../common/testing/migration-function';
import { MARK_GRACE_MS, sparWindows } from './spar-windows';

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

  it('throws on a zone it cannot read, naming the step and the zone', () => {
    expect(() => sparWindows({ ...PARIS_ROW, zone: 'Nowhere/Atlantis' })).toThrow(
      'spar windows: no day start in zone Nowhere/Atlantis',
    );
  });

  it('keeps the same 48 h grace as the database’s own check in fightbook_review', () => {
    expect(MARK_GRACE_MS).toBe(48 * 3600 * 1000);
    expect(lastFunctionBody('fightbook_review')).toContain(
      "r.expires_at + interval '48 hours' <= p_now",
    );
  });
});
