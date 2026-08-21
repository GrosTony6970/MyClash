import { describe, expect, it } from 'vitest';
import {
  allTournamentsSelected,
  eventDayIsosFor,
  filterBoardPools,
  tournamentsForDay,
} from './filter-board-pools';

const unit = (tournamentId: string, tournamentName: string, scheduledStart: string | null) => ({
  tournamentId,
  tournamentName,
  scheduledStart,
});

// Three clocks on purpose. UTC and Europe/Paris agree for most of a working
// day, so a test using only those two passes whether the code reads the event
// timezone or the UTC day. America/Los_Angeles is west of UTC, which is where
// the two answers come apart.
const UTC = 'UTC';
const PARIS = 'Europe/Paris';
const LA = 'America/Los_Angeles';

/** 04:00 in Paris, 19:00 the PREVIOUS day in Los Angeles. */
const EARLY_MORNING = '2026-05-22T02:00:00.000Z';
/** 01:00 the NEXT day in Paris, still the 21st in UTC. */
const LATE_EVENING = '2026-05-21T23:00:00.000Z';

describe('filterBoardPools', () => {
  it('measures the day on the event timezone, not UTC', () => {
    const units = [unit('t1', 'Longsword', EARLY_MORNING)];

    expect(
      filterBoardPools(units, { dayIso: '2026-05-22', tz: UTC, tournamentIds: ['t1'] }),
    ).toEqual(units);
    expect(
      filterBoardPools(units, { dayIso: '2026-05-22', tz: PARIS, tournamentIds: ['t1'] }),
    ).toEqual(units);
    // West of UTC the same instant is the day before.
    expect(
      filterBoardPools(units, { dayIso: '2026-05-22', tz: LA, tournamentIds: ['t1'] }),
    ).toEqual([]);
    expect(
      filterBoardPools(units, { dayIso: '2026-05-21', tz: LA, tournamentIds: ['t1'] }),
    ).toEqual(units);
  });

  it('separates Europe/Paris from UTC on a late-evening instant', () => {
    const units = [unit('t1', 'Longsword', LATE_EVENING)];

    expect(
      filterBoardPools(units, { dayIso: '2026-05-21', tz: UTC, tournamentIds: ['t1'] }),
    ).toEqual(units);
    expect(
      filterBoardPools(units, { dayIso: '2026-05-22', tz: PARIS, tournamentIds: ['t1'] }),
    ).toEqual(units);
  });

  it('keeps nothing when no tournament is selected', () => {
    const units = [unit('t1', 'Longsword', EARLY_MORNING), unit('t2', 'Sabre', EARLY_MORNING)];

    expect(filterBoardPools(units, { dayIso: null, tz: PARIS, tournamentIds: [] })).toEqual([]);
  });

  it('keeps only the selected tournaments', () => {
    const longsword = unit('t1', 'Longsword', EARLY_MORNING);
    const sabre = unit('t2', 'Sabre', EARLY_MORNING);

    expect(
      filterBoardPools([longsword, sabre], { dayIso: null, tz: PARIS, tournamentIds: ['t2'] }),
    ).toEqual([sabre]);
  });

  it('shows unscheduled units under every day, and hides them under one day', () => {
    const unscheduled = unit('t1', 'Longsword', null);

    expect(
      filterBoardPools([unscheduled], { dayIso: null, tz: PARIS, tournamentIds: ['t1'] }),
    ).toEqual([unscheduled]);
    expect(
      filterBoardPools([unscheduled], { dayIso: '2026-05-22', tz: PARIS, tournamentIds: ['t1'] }),
    ).toEqual([]);
  });

  it('still applies the tournament filter to unscheduled units', () => {
    const unscheduled = unit('t1', 'Longsword', null);

    expect(
      filterBoardPools([unscheduled], { dayIso: null, tz: PARIS, tournamentIds: ['t2'] }),
    ).toEqual([]);
  });
});

describe('eventDayIsosFor', () => {
  it('walks the event span inclusively', () => {
    expect(eventDayIsosFor('2026-05-22', '2026-05-24', [], PARIS)).toEqual([
      '2026-05-22',
      '2026-05-23',
      '2026-05-24',
    ]);
  });

  it('adds days a unit is scheduled on but the event span never covered', () => {
    // The defect this closes: a unit outside the event dates was reachable
    // only under "All days", because no chip could ever match it.
    const units = [unit('t1', 'Longsword', '2026-08-20T17:09:00.000Z')];

    expect(eventDayIsosFor('2026-05-22', '2026-05-23', units, PARIS)).toEqual([
      '2026-05-22',
      '2026-05-23',
      '2026-08-20',
    ]);
  });

  it('de-duplicates a unit day the span already covers', () => {
    const units = [unit('t1', 'Longsword', EARLY_MORNING), unit('t2', 'Sabre', EARLY_MORNING)];

    expect(eventDayIsosFor('2026-05-22', '2026-05-22', units, PARIS)).toEqual(['2026-05-22']);
  });

  it('adds the unit day the event timezone puts it on', () => {
    const units = [unit('t1', 'Longsword', EARLY_MORNING)];

    expect(eventDayIsosFor(null, null, units, LA)).toEqual(['2026-05-21']);
    expect(eventDayIsosFor(null, null, units, PARIS)).toEqual(['2026-05-22']);
  });

  it('ignores unscheduled units, which belong to no day', () => {
    expect(
      eventDayIsosFor('2026-05-22', '2026-05-22', [unit('t1', 'Longsword', null)], PARIS),
    ).toEqual(['2026-05-22']);
  });
});

describe('tournamentsForDay', () => {
  it('lists each tournament once, ordered by when it first runs', () => {
    const units = [
      unit('t2', 'Sabre', '2026-05-22T09:00:00.000Z'),
      unit('t1', 'Longsword', '2026-05-22T08:00:00.000Z'),
      unit('t2', 'Sabre', '2026-05-22T07:00:00.000Z'),
    ];

    expect(tournamentsForDay(units, '2026-05-22', PARIS)).toEqual([
      { id: 't2', name: 'Sabre' },
      { id: 't1', name: 'Longsword' },
    ]);
  });

  it('breaks a tie on name so the order is stable', () => {
    const units = [
      unit('t2', 'Sabre', '2026-05-22T08:00:00.000Z'),
      unit('t1', 'Longsword', '2026-05-22T08:00:00.000Z'),
    ];

    expect(tournamentsForDay(units, '2026-05-22', PARIS).map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('sorts a tournament with only unscheduled units last', () => {
    const units = [unit('t1', 'Longsword', null), unit('t2', 'Sabre', '2026-05-22T08:00:00.000Z')];

    expect(tournamentsForDay(units, null, PARIS).map((t) => t.id)).toEqual(['t2', 't1']);
  });

  it('scopes to the selected day on the event timezone', () => {
    const units = [unit('t1', 'Longsword', EARLY_MORNING), unit('t2', 'Sabre', LATE_EVENING)];

    // In Paris both land on the 22nd; in Los Angeles they split across days.
    expect(tournamentsForDay(units, '2026-05-22', PARIS).map((t) => t.id)).toEqual(['t2', 't1']);
    expect(tournamentsForDay(units, '2026-05-21', LA).map((t) => t.id)).toEqual(['t2', 't1']);
    expect(tournamentsForDay(units, '2026-05-22', LA)).toEqual([]);
  });

  it('lists every tournament in the event when no day is selected', () => {
    const units = [unit('t1', 'Longsword', EARLY_MORNING), unit('t2', 'Sabre', null)];

    expect(tournamentsForDay(units, null, PARIS).map((t) => t.id)).toEqual(['t1', 't2']);
  });
});

describe('allTournamentsSelected', () => {
  const options = [
    { id: 't1', name: 'Longsword' },
    { id: 't2', name: 'Sabre' },
  ];

  it('is true only when every tournament on offer is selected', () => {
    expect(allTournamentsSelected(options, ['t1', 't2'])).toBe(true);
    expect(allTournamentsSelected(options, ['t1'])).toBe(false);
    expect(allTournamentsSelected(options, [])).toBe(false);
  });

  it('is true with nothing on offer, so the chip is never stuck unlit', () => {
    expect(allTournamentsSelected([], [])).toBe(true);
  });

  it('ignores a selected id no longer on offer', () => {
    expect(allTournamentsSelected(options, ['t1', 't2', 't3'])).toBe(true);
  });
});
