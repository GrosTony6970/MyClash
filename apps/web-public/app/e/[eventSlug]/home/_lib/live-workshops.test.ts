import { describe, expect, it } from 'vitest';
import type { PublicWorkshop } from './public-event-data';
import {
  isSessionLive,
  nextSessionStart,
  liveWorkshops,
  upcomingWorkshops,
} from './live-workshops';

const NOW = Date.parse('2027-05-22T10:30:00Z');

function ws(
  slug: string,
  sessions: Array<{ startsAt: string | null; endsAt: string | null }>,
): PublicWorkshop {
  return {
    id: slug,
    slug,
    title: slug,
    category: null,
    level: null,
    color: null,
    coverImageUrl: null,
    durationMinutes: null,
    instructors: [],
    sessions,
  };
}

describe('isSessionLive', () => {
  it('is true only when now is inside [start, end)', () => {
    expect(
      isSessionLive({ startsAt: '2027-05-22T10:00:00Z', endsAt: '2027-05-22T12:00:00Z' }, NOW),
    ).toBe(true);
  });

  it('is false before the window and at/after the end (half-open)', () => {
    expect(
      isSessionLive({ startsAt: '2027-05-22T11:00:00Z', endsAt: '2027-05-22T12:00:00Z' }, NOW),
    ).toBe(false);
    // ends exactly at NOW → not live (end is exclusive)
    expect(
      isSessionLive({ startsAt: '2027-05-22T09:00:00Z', endsAt: '2027-05-22T10:30:00Z' }, NOW),
    ).toBe(false);
  });

  it('is true exactly at the start (start is inclusive)', () => {
    expect(
      isSessionLive({ startsAt: '2027-05-22T10:30:00Z', endsAt: '2027-05-22T11:00:00Z' }, NOW),
    ).toBe(true);
  });

  it('is false when a bound is missing or unparseable', () => {
    expect(isSessionLive({ startsAt: null, endsAt: '2027-05-22T12:00:00Z' }, NOW)).toBe(false);
    expect(isSessionLive({ startsAt: '2027-05-22T10:00:00Z', endsAt: null }, NOW)).toBe(false);
    expect(isSessionLive({ startsAt: 'not-a-date', endsAt: 'nope' }, NOW)).toBe(false);
  });

  it('stays correct across a DST change (absolute-instant comparison)', () => {
    // Europe/Paris springs forward 2027-03-28 02:00→03:00. A window straddling
    // it is still ~1h of real time; a NOW inside it is live regardless of tz.
    const dstNow = Date.parse('2027-03-28T01:30:00Z'); // 02:30 CET, inside
    expect(
      isSessionLive({ startsAt: '2027-03-28T01:00:00Z', endsAt: '2027-03-28T02:00:00Z' }, dstNow),
    ).toBe(true);
  });
});

describe('nextSessionStart', () => {
  it('returns the soonest future start', () => {
    const w = ws('a', [
      { startsAt: '2027-05-22T14:00:00Z', endsAt: '2027-05-22T16:00:00Z' },
      { startsAt: '2027-05-22T11:00:00Z', endsAt: '2027-05-22T12:00:00Z' },
    ]);
    expect(nextSessionStart(w, NOW)).toBe(Date.parse('2027-05-22T11:00:00Z'));
  });

  it('ignores past and already-started sessions', () => {
    const w = ws('a', [{ startsAt: '2027-05-22T09:00:00Z', endsAt: '2027-05-22T09:30:00Z' }]);
    expect(nextSessionStart(w, NOW)).toBeNull();
  });
});

describe('liveWorkshops', () => {
  it('keeps only workshops with a session in progress', () => {
    const live = ws('live', [{ startsAt: '2027-05-22T10:00:00Z', endsAt: '2027-05-22T12:00:00Z' }]);
    const soon = ws('soon', [{ startsAt: '2027-05-22T14:00:00Z', endsAt: '2027-05-22T16:00:00Z' }]);
    expect(liveWorkshops([live, soon], NOW).map((w) => w.slug)).toEqual(['live']);
  });
});

describe('upcomingWorkshops', () => {
  it('excludes live and past workshops, sorts by soonest start, and caps', () => {
    const live = ws('live', [{ startsAt: '2027-05-22T10:00:00Z', endsAt: '2027-05-22T12:00:00Z' }]);
    const past = ws('past', [{ startsAt: '2027-05-22T08:00:00Z', endsAt: '2027-05-22T09:00:00Z' }]);
    const s14 = ws('s14', [{ startsAt: '2027-05-22T14:00:00Z', endsAt: '2027-05-22T16:00:00Z' }]);
    const s12 = ws('s12', [{ startsAt: '2027-05-22T12:00:00Z', endsAt: '2027-05-22T13:00:00Z' }]);
    const s16 = ws('s16', [{ startsAt: '2027-05-22T16:00:00Z', endsAt: '2027-05-22T17:00:00Z' }]);

    const result = upcomingWorkshops([live, past, s14, s12, s16], NOW, 2);
    expect(result.map((w) => w.slug)).toEqual(['s12', 's14']);
  });

  it('defaults to a cap of 3', () => {
    const many = [12, 13, 14, 15].map((h) =>
      ws(`s${h}`, [{ startsAt: `2027-05-22T${h}:00:00Z`, endsAt: `2027-05-22T${h}:30:00Z` }]),
    );
    expect(upcomingWorkshops(many, NOW)).toHaveLength(3);
  });
});
