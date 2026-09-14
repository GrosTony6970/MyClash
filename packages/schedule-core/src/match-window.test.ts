import { describe, expect, it } from 'vitest';
import { hullMs, matchWindowMs, overlapsHalfOpen } from './match-window';

const at = (iso: string) => Date.parse(iso);
const MIN = 60_000;

describe('matchWindowMs', () => {
  it('runs from the start for the planned length', () => {
    expect(matchWindowMs('2027-06-21T10:00:00.000Z', 8)).toEqual({
      startMs: at('2027-06-21T10:00:00.000Z'),
      endMs: at('2027-06-21T10:08:00.000Z'),
    });
  });

  it('reads the offset in the time, never the machine zone', () => {
    // The same instant written two ways gives the same window. Only an ISO with
    // no offset would be read in local time, and the API never sends one.
    expect(matchWindowMs('2027-06-21T11:00:00+02:00', 8)).toEqual(
      matchWindowMs('2027-06-21T09:00:00.000Z', 8),
    );
  });

  it('refuses a start it cannot read', () => {
    expect(() => matchWindowMs('not a time', 8)).toThrow(RangeError);
  });

  it('refuses a length that is not a positive number', () => {
    // Both would hide a clash silently: a zero-length window at 10:00 does not
    // overlap a bout that starts at 10:00, and a NaN one overlaps nothing.
    for (const length of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => matchWindowMs('2027-06-21T10:00:00.000Z', length)).toThrow(RangeError);
    }
  });
});

describe('overlapsHalfOpen', () => {
  const tenToHalfPast = matchWindowMs('2027-06-21T10:00:00.000Z', 30);

  it('a bout ending when the next starts does not overlap it', () => {
    const next = matchWindowMs('2027-06-21T10:30:00.000Z', 8);
    expect(overlapsHalfOpen(tenToHalfPast, next)).toBe(false);
    expect(overlapsHalfOpen(next, tenToHalfPast)).toBe(false);
  });

  it('one minute inside is an overlap, whichever side is asked', () => {
    const early = matchWindowMs('2027-06-21T10:29:00.000Z', 8);
    expect(overlapsHalfOpen(tenToHalfPast, early)).toBe(true);
    expect(overlapsHalfOpen(early, tenToHalfPast)).toBe(true);
  });

  it('a window inside another overlaps it', () => {
    const inside = matchWindowMs('2027-06-21T10:10:00.000Z', 5);
    expect(overlapsHalfOpen(tenToHalfPast, inside)).toBe(true);
    expect(overlapsHalfOpen(inside, tenToHalfPast)).toBe(true);
  });
});

describe('hullMs', () => {
  it('is null for no windows', () => {
    expect(hullMs([])).toBeNull();
  });

  it('runs from the earliest start to the last end', () => {
    const pool = ['10:00', '10:08', '10:16', '10:24'].map((hhmm) =>
      matchWindowMs(`2027-06-21T${hhmm}:00.000Z`, 8),
    );
    expect(hullMs(pool)).toEqual({
      startMs: at('2027-06-21T10:00:00.000Z'),
      endMs: at('2027-06-21T10:32:00.000Z'),
    });
  });

  it('a straggler stretches the hull to its own end', () => {
    const pool = [
      matchWindowMs('2027-06-21T10:00:00.000Z', 8),
      matchWindowMs('2027-06-21T10:08:00.000Z', 8),
      matchWindowMs('2027-06-21T14:00:00.000Z', 8),
    ];
    expect(hullMs(pool)).toEqual({
      startMs: at('2027-06-21T10:00:00.000Z'),
      endMs: at('2027-06-21T14:08:00.000Z'),
    });
  });

  it('the latest END wins when the longest bout is not the last to start', () => {
    const run = [
      matchWindowMs('2027-06-21T10:00:00.000Z', 30),
      matchWindowMs('2027-06-21T10:05:00.000Z', 5),
    ];
    expect(hullMs(run)!.endMs).toBe(at('2027-06-21T10:30:00.000Z'));
  });

  it('a run fanned across two Lices is one hull', () => {
    // Windows carry no Lice: two bouts side by side at 10:00 and two at 10:08
    // are one span, 10:00 to 10:16.
    const run = ['10:00', '10:00', '10:08', '10:08'].map((hhmm) =>
      matchWindowMs(`2027-06-21T${hhmm}:00.000Z`, 8),
    );
    expect(hullMs(run)).toEqual({
      startMs: at('2027-06-21T10:00:00.000Z'),
      endMs: at('2027-06-21T10:00:00.000Z') + 16 * MIN,
    });
  });

  it('does not depend on the order of its windows', () => {
    const a = matchWindowMs('2027-06-21T10:00:00.000Z', 30);
    const b = matchWindowMs('2027-06-21T09:00:00.000Z', 5);
    expect(hullMs([a, b])).toEqual(hullMs([b, a]));
    expect(hullMs([a, b])!.startMs).toBe(at('2027-06-21T09:00:00.000Z'));
  });
});
