import { describe, expect, it } from 'vitest';
import {
  applySessionEdits,
  blankLine,
  linesOf,
  removedSessions,
  sessionEdits,
  type ExistingSession,
  type SessionLine,
} from './session-edits';

/**
 * The Workshop form's sessions (slice 2.1, rulings 515, 524, 525). "Longsword basics" runs
 * Saturday 10:00 in the Main hall, room A. The organiser adds Sunday 14:00 in the Annex, and moves
 * Saturday to 11:00. Paris is UTC+2 in June.
 */
const TZ = 'Europe/Paris';
const SATURDAY: ExistingSession = {
  id: 's-saturday',
  startsAt: '2027-06-05T08:00:00.000Z',
  endsAt: '2027-06-05T09:30:00.000Z',
  venueId: 'v-hall',
  areaId: 'a-room-a',
};
const saturdayLine: SessionLine = {
  id: 's-saturday',
  day: '2027-06-05',
  start: '10:00',
  end: '11:30',
  venueId: 'v-hall',
};

describe('linesOf', () => {
  it('gives one line per session, in the Event zone', () => {
    expect(linesOf([SATURDAY], TZ, 'v-default')).toEqual([saturdayLine]);
  });

  it("gives one blank line, with the Workshop's venue, to a Workshop with no session", () => {
    expect(linesOf([], TZ, 'v-default')).toEqual([blankLine('v-default')]);
  });
});

describe('sessionEdits', () => {
  it('sends nothing for lines that did not change', () => {
    expect(sessionEdits([saturdayLine], [SATURDAY], TZ, 90, 'v-default')).toEqual([]);
  });

  it('adds a new line, moves a changed one by its id keeping its room, in line order', () => {
    const lines: SessionLine[] = [
      { ...saturdayLine, start: '11:00', end: '12:30' },
      { id: null, day: '2027-06-06', start: '14:00', end: '', venueId: 'v-annex' },
    ];
    expect(sessionEdits(lines, [SATURDAY], TZ, 90, 'v-default')).toEqual([
      {
        method: 'PATCH',
        line: 0,
        sessionId: 's-saturday',
        body: {
          startTime: '2027-06-05T09:00:00.000Z',
          endTime: '2027-06-05T10:30:00.000Z',
          venueId: 'v-hall',
          areaId: 'a-room-a',
        },
      },
      {
        method: 'POST',
        line: 1,
        // No end: the Workshop's 90 minutes.
        body: {
          startTime: '2027-06-06T12:00:00.000Z',
          endTime: '2027-06-06T13:30:00.000Z',
          venueId: 'v-annex',
        },
      },
    ]);
  });

  it("takes a session to the venue picked on its line, out of the old venue's room (525)", () => {
    const [call] = sessionEdits(
      [{ ...saturdayLine, venueId: 'v-annex' }],
      [SATURDAY],
      TZ,
      90,
      'v-default',
    );
    expect(call).toMatchObject({ method: 'PATCH', body: { venueId: 'v-annex', areaId: null } });
  });

  it('removes a session whose line was removed or whose day was cleared', () => {
    expect(sessionEdits([], [SATURDAY], TZ, 90, 'v-default')).toEqual([
      { method: 'DELETE', sessionId: 's-saturday' },
    ]);
    expect(sessionEdits([{ ...saturdayLine, day: '' }], [SATURDAY], TZ, 90, 'v-default')).toEqual([
      { method: 'DELETE', sessionId: 's-saturday' },
    ]);
    expect(removedSessions([], [SATURDAY], TZ, 90)).toEqual([SATURDAY]);
  });

  it('skips a new line with no day or start', () => {
    expect(
      sessionEdits([saturdayLine, blankLine('v-hall')], [SATURDAY], TZ, 90, 'v-default'),
    ).toEqual([]);
  });

  it("gives a new line with no venue the Workshop's venue", () => {
    const line: SessionLine = { id: null, day: '2027-06-06', start: '14:00', end: '', venueId: '' };
    expect(sessionEdits([line], [], TZ, 90, 'v-default')[0]).toMatchObject({
      method: 'POST',
      body: { venueId: 'v-default' },
    });
  });

  // A save that failed half-way, saved again before the page's list reloaded: the line created
  // the first time holds its id, and the list does not know it yet.
  it('never posts again a line that has an id', () => {
    const created: SessionLine = {
      id: 's-new',
      day: '2027-06-06',
      start: '14:00',
      end: '',
      venueId: '',
    };
    expect(sessionEdits([saturdayLine, created], [SATURDAY], TZ, 90, 'v-default')).toEqual([]);
  });
});

/**
 * A creation is no longer an upsert (0257). The organiser adds Sunday and Monday; Sunday is
 * created, Monday is refused, and the form stays open. A second save must create Monday only.
 */
describe('a save that fails half-way, saved again', () => {
  const sunday: SessionLine = {
    id: null,
    day: '2027-06-06',
    start: '14:00',
    end: '',
    venueId: 'v-hall',
  };
  const monday: SessionLine = {
    id: null,
    day: '2027-06-07',
    start: '14:00',
    end: '',
    venueId: 'v-hall',
  };

  it('creates only the session the first save did not', async () => {
    const posted: string[] = [];
    let refuseMonday = true;
    const send = async (call: Parameters<Parameters<typeof applySessionEdits>[2]>[0]) => {
      if (call.method !== 'POST') return { ok: true as const };
      const day = call.body.startTime.slice(0, 10);
      posted.push(day);
      if (day === '2027-06-07' && refuseMonday) return { ok: false as const, failure: 'refused' };
      return { ok: true as const, id: `s-${day}` };
    };

    const first = await applySessionEdits(
      sessionEdits([sunday, monday], [], TZ, 90, ''),
      [sunday, monday],
      send,
    );
    expect(first.failure).toBe('refused');
    expect(first.lines.map((l) => l.id)).toEqual(['s-2027-06-06', null]);

    refuseMonday = false;
    posted.length = 0;
    // The page's list has not reloaded yet: it still holds no session.
    await applySessionEdits(sessionEdits(first.lines, [], TZ, 90, ''), first.lines, send);
    expect(posted).toEqual(['2027-06-07']);
  });
});
