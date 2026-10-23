import { describe, expect, it } from 'vitest';
import { eventOpenWindow } from './event-open-window';

/**
 * When an Event's days begin and end, on its own clock (rulings 152, 154).
 *
 * Every zone here differs from the default one where it can: the default, the
 * dev box and a CI leg are all Europe/Paris, so a zone read off the wrong place
 * looks identical to one read right when the Event is in Paris too.
 */
const at = (iso: string) => new Date(iso);

describe('eventOpenWindow', () => {
  it('opens a New York Event at 00:00 and closes it at 06:00 after its last day, New York time', () => {
    const window = eventOpenWindow({
      start_date: '2026-11-06',
      end_date: '2026-11-07',
      timezone: 'America/New_York',
    });

    // EST (UTC-5): the clocks went back on 1 November 2026.
    expect(window).toEqual({
      opensAt: at('2026-11-06T05:00:00.000Z'),
      closesAt: at('2026-11-08T11:00:00.000Z'),
      unknownZone: false,
    });
    const paris = eventOpenWindow({
      start_date: '2026-11-06',
      end_date: '2026-11-07',
      timezone: 'Europe/Paris',
    });
    expect(paris?.opensAt).not.toEqual(window?.opensAt);
    expect(paris?.closesAt).not.toEqual(window?.closesAt);
  });

  it('closes a summer Paris Event at 06:00 CEST', () => {
    const window = eventOpenWindow({
      start_date: '2026-07-11',
      end_date: '2026-07-12',
      timezone: 'Europe/Paris',
    });
    expect(window?.closesAt).toEqual(at('2026-07-13T04:00:00.000Z'));
  });

  it('closes at 06:00 CET when the clocks go back during the last night', () => {
    // Paris leaves summer time at 03:00 on 25 October 2026, so 06:00 that morning is UTC+1.
    const window = eventOpenWindow({
      start_date: '2026-10-24',
      end_date: '2026-10-24',
      timezone: 'Europe/Paris',
    });
    expect(window?.closesAt).toEqual(at('2026-10-25T05:00:00.000Z'));
  });

  it('opens a Kiritimati Event on the previous UTC day', () => {
    const window = eventOpenWindow({
      start_date: '2026-07-10',
      end_date: '2026-07-10',
      timezone: 'Pacific/Kiritimati',
    });
    expect(window?.opensAt).toEqual(at('2026-07-09T10:00:00.000Z'));
  });

  /**
   * Luxon reads `undefined`, `null` and `'local'` as the SYSTEM zone, valid and
   * silent: without the guard those three would land on the server's clock and
   * report the zone as known.
   */
  it.each<unknown>(['Mars/Olympus', undefined, null, 'local'])(
    'reads the days in Europe/Paris and flags the zone when it is %s',
    (timezone) => {
      const window = eventOpenWindow({
        start_date: '2026-07-11',
        end_date: '2026-07-12',
        timezone: timezone as string,
      });
      expect(window).toEqual({
        opensAt: at('2026-07-10T22:00:00.000Z'),
        closesAt: at('2026-07-13T04:00:00.000Z'),
        unknownZone: true,
      });
    },
  );

  it.each<[string | null, string | null]>([
    [null, '2026-07-12'],
    ['2026-07-11', null],
    ['2026-07-11', '2026-13-40'],
  ])('answers null when a date cannot be read (start %s, end %s)', (start, end) => {
    expect(
      eventOpenWindow({ start_date: start, end_date: end, timezone: 'Europe/Paris' }),
    ).toBeNull();
  });
});
