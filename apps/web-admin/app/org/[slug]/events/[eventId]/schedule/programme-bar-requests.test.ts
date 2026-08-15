import { describe, expect, it } from 'vitest';
import { breakEditSteps } from './break-edit-steps';
import {
  barEditRequest,
  createBarRequest,
  delayDayRequest,
  deleteBarRequest,
  moveBarRequest,
  resizeBarEndRequest,
  resizeBarStartRequest,
  type BarRequest,
  type ProgrammeTarget,
} from './programme-bar-requests';

const target: ProgrammeTarget = { apiUrl: 'https://api.test', eventId: 'ev-1' };
const BASE = 'https://api.test/api/v1/events/ev-1/programme/blocks';

describe('programme bar requests', () => {
  /**
   * The reason this module exists. The base path was written out by hand at
   * eight call sites, so a path change could fix seven of them and miss one.
   * Every request in the family is checked against a single literal here.
   */
  it('roots every request at the one programme-blocks collection', () => {
    const all: BarRequest[] = [
      createBarRequest(target, {
        dayIndex: 0,
        blockType: 'break',
        label: 'Lunch',
        startTime: '12:00',
        endTime: '13:00',
      }),
      deleteBarRequest(target, 'b-1'),
      moveBarRequest(target, 'b-1', '11:30'),
      resizeBarEndRequest(target, 'b-1', '13:30'),
      resizeBarStartRequest(target, 'b-1', '11:30'),
      barEditRequest(target, 'b-1', { kind: 'label', label: 'x', colorHex: null }),
    ];

    for (const request of all) expect(request.url.startsWith(BASE)).toBe(true);
  });

  it('POSTs a new bar to the collection', () => {
    expect(
      createBarRequest(target, {
        dayIndex: 2,
        blockType: 'break',
        label: 'Lunch',
        startTime: '12:00',
        endTime: '13:00',
        colorHex: '#ff0000',
      }),
    ).toEqual({
      url: BASE,
      init: {
        method: 'POST',
        body: {
          dayIndex: 2,
          blockType: 'break',
          label: 'Lunch',
          startTime: '12:00',
          endTime: '13:00',
          colorHex: '#ff0000',
        },
      },
    });
  });

  /**
   * The undo path re-creates a deleted bar from a snapshot that never captured a
   * colour, and has always POSTed without the key. An explicit null is a
   * different request — the server would read it as "clear the colour" rather
   * than "none given" — so the two shapes have to stay distinguishable.
   */
  it('omits colorHex when the caller omits it, and sends null when asked', () => {
    const omitted = createBarRequest(target, {
      dayIndex: 0,
      blockType: 'admin',
      label: 'Briefing',
      startTime: '08:00',
      endTime: '08:30',
    });
    const explicit = createBarRequest(target, {
      dayIndex: 0,
      blockType: 'admin',
      label: 'Briefing',
      startTime: '08:00',
      endTime: '08:30',
      colorHex: null,
    });

    expect('colorHex' in (omitted.init.body as object)).toBe(false);
    expect('colorHex' in (explicit.init.body as object)).toBe(true);
    expect((explicit.init.body as { colorHex: unknown }).colorHex).toBeNull();
  });

  /** No body at all, so `mutateSchedule` sends no Content-Type with the DELETE. */
  it('deletes without a body', () => {
    const request = deleteBarRequest(target, 'b-9');

    expect(request).toEqual({ url: `${BASE}/b-9`, init: { method: 'DELETE' } });
    expect('body' in request.init).toBe(false);
  });

  it('sends a retime to /move, which is the endpoint that cascades', () => {
    expect(moveBarRequest(target, 'b-1', '11:30')).toEqual({
      url: `${BASE}/b-1/move`,
      init: { method: 'PATCH', body: { newStartTime: '11:30' } },
    });
  });

  /**
   * The whole-day delay is NOT under a bar: no bar is being dragged, so it
   * hangs off the programme itself. Routing it through a bar would have meant
   * inventing one to carry the day's delay.
   */
  it('sends the whole-day delay to the programme, not to a bar', () => {
    expect(delayDayRequest(target, { dayIndex: 1, fromTime: '14:35', deltaMinutes: 20 })).toEqual({
      url: 'https://api.test/api/v1/events/ev-1/programme/delay',
      init: { method: 'POST', body: { dayIndex: 1, fromTime: '14:35', deltaMinutes: 20 } },
    });
  });

  /**
   * Both edge drags go to /resize. The top edge is NOT a move: dragging it means
   * "this bar gets shorter", and routing it to /move would shift the whole rest
   * of the day instead.
   */
  it('sends both edge drags to /resize, each with only its own edge', () => {
    expect(resizeBarEndRequest(target, 'b-1', '13:30')).toEqual({
      url: `${BASE}/b-1/resize`,
      init: { method: 'PATCH', body: { newEndTime: '13:30' } },
    });
    expect(resizeBarStartRequest(target, 'b-1', '11:30')).toEqual({
      url: `${BASE}/b-1/resize`,
      init: { method: 'PATCH', body: { newStartTime: '11:30' } },
    });
  });

  it('PATCHes a rename plus its colour onto the bar itself', () => {
    expect(
      barEditRequest(target, 'b-1', { kind: 'label', label: 'Long lunch', colorHex: null }),
    ).toEqual({
      url: `${BASE}/b-1`,
      init: { method: 'PATCH', body: { label: 'Long lunch', colorHex: null } },
    });
  });

  /**
   * The popover's steps carry the ordering rule; this carries the routing. A
   * move step arriving at /resize would silently stop the day cascading, and
   * nothing about the step's own shape would show it.
   */
  it('routes a popover save to three different endpoints, in order', () => {
    const steps = breakEditSteps(
      { label: 'Lunch', startTime: '12:00', endTime: '13:00', colorHex: null },
      { label: 'Long lunch', startHHMM: '11:30', endHHMM: '13:15', colorHex: '' },
    );

    expect(steps.map((s) => s.kind)).toEqual(['label', 'move', 'resize']);
    expect(steps.map((step) => barEditRequest(target, 'b-1', step))).toEqual([
      {
        url: `${BASE}/b-1`,
        init: { method: 'PATCH', body: { label: 'Long lunch', colorHex: null } },
      },
      { url: `${BASE}/b-1/move`, init: { method: 'PATCH', body: { newStartTime: '11:30' } } },
      { url: `${BASE}/b-1/resize`, init: { method: 'PATCH', body: { newEndTime: '13:15' } } },
    ]);
  });
});
