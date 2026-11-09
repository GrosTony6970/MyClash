import { describe, expect, it } from 'vitest';
import {
  firstSessionStart,
  groupWorkshopsByDay,
  WORKSHOP_UNSCHEDULED,
  workshopDayKeys,
  type WorkshopListItem,
} from './workshop-grouping';

const TZ = 'Europe/Paris';

/** A workshop with one session per ISO passed (null ⇒ an undated session). */
const ws = (id: string, starts: Array<string | null>, title = id): WorkshopListItem => ({
  id,
  slug: id,
  title,
  shortDescription: null,
  descriptionMd: null,
  category: null,
  level: null,
  weapon: null,
  language: null,
  color: null,
  coverImageUrl: null,
  capacity: null,
  durationMinutes: null,
  sessions: starts.map((startsAt, i) => ({
    id: `${id}-s${i}`,
    startsAt,
    endsAt: null,
    locationLabel: null,
    venue: null,
    area: null,
    capacity: null,
    confirmedCount: 0,
  })),
  instructors: [],
});

describe('firstSessionStart', () => {
  it('returns the earliest dated session', () => {
    const w = ws('w', ['2027-05-22T14:00:00Z', '2027-05-22T09:00:00Z']);
    expect(firstSessionStart(w)).toBe('2027-05-22T09:00:00Z');
  });

  it('skips undated sessions and returns null when none are dated', () => {
    expect(firstSessionStart(ws('w', [null, '2027-05-22T09:00:00Z']))).toBe('2027-05-22T09:00:00Z');
    expect(firstSessionStart(ws('w', [null]))).toBeNull();
  });
});

describe('groupWorkshopsByDay', () => {
  it('orders days ascending and puts the unscheduled bucket last', () => {
    const groups = groupWorkshopsByDay(
      [ws('sun', ['2027-05-23T09:00:00Z']), ws('tbd', [null]), ws('sat', ['2027-05-22T09:00:00Z'])],
      TZ,
    );
    expect(groups.map((g) => g.items.map((w) => w.id))).toEqual([['sat'], ['sun'], ['tbd']]);
    expect(groups[groups.length - 1]!.key).toBe(WORKSHOP_UNSCHEDULED);
  });

  it('orders workshops WITHIN a day by session start, not by arrival order', () => {
    // The API returns these in admin `sort_order` / title order.
    const groups = groupWorkshopsByDay(
      [
        ws('afternoon', ['2027-05-22T14:00:00Z']),
        ws('morning', ['2027-05-22T09:00:00Z']),
        ws('midday', ['2027-05-22T11:30:00Z']),
      ],
      TZ,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items.map((w) => w.id)).toEqual(['morning', 'midday', 'afternoon']);
  });

  it('breaks a shared start on title so the order is stable', () => {
    const at = '2027-05-22T09:00:00Z';
    const groups = groupWorkshopsByDay(
      [ws('b', [at], 'Zweihander drills'), ws('a', [at], 'Alpha footwork')],
      TZ,
    );
    expect(groups[0]!.items.map((w) => w.id)).toEqual(['a', 'b']);
  });

  it('reports the earliest start of the day as repIso', () => {
    const groups = groupWorkshopsByDay(
      [ws('late', ['2027-05-22T14:00:00Z']), ws('early', ['2027-05-22T09:00:00Z'])],
      TZ,
    );
    expect(groups[0]!.repIso).toBe('2027-05-22T09:00:00Z');
  });

  it('returns no groups for an empty list', () => {
    expect(groupWorkshopsByDay([], TZ)).toEqual([]);
  });

  // "Longsword basics" runs Saturday and Sunday (ruling 515): it was listed under Saturday alone.
  it('lists a Workshop under each day it runs, with that day’s sessions only', () => {
    const longsword = ws('longsword', ['2027-05-23T12:00:00Z', '2027-05-22T08:00:00Z']);
    const groups = groupWorkshopsByDay([longsword], TZ);
    expect(groups.map((g) => [g.key, g.items.map((w) => w.sessions.map((s) => s.id))])).toEqual([
      ['2027-05-22', [['longsword-s1']]],
      ['2027-05-23', [['longsword-s0']]],
    ]);
  });

  // Saturday was cancelled: it stays on Saturday, struck through, so people who saw it know it is
  // off (ruling 526).
  it('keeps a cancelled session on its day, carried by its card', () => {
    const w = ws('w', ['2027-05-22T08:00:00Z', '2027-05-23T08:00:00Z']);
    w.sessions[0]!.status = 'cancelled';
    const groups = groupWorkshopsByDay([w], TZ);
    expect(groups.map((g) => [g.key, g.items[0]!.sessions.map((s) => [s.id, s.status])])).toEqual([
      ['2027-05-22', [['w-s0', 'cancelled']]],
      ['2027-05-23', [['w-s1', undefined]]],
    ]);
    expect(workshopDayKeys(w, TZ)).toEqual(['2027-05-22', '2027-05-23']);
  });
});
