import { describe, expect, it } from 'vitest';
import {
  matchBelongsToDay,
  occupantsOnLice,
  planMatchDrop,
  type PlannableMatch,
} from './plan-match-drop';

/**
 * The cascade is the invariant that matters most on this board: dropping a match
 * onto an occupied slot must push the occupant out of the way rather than
 * double-book the lice. One browser spec covers it end to end; these cover the
 * decisions that feed it, which is where the plausible mistakes are — the wrong
 * occupant set, the wrong span, or a match colliding with itself.
 */

const DAY = '2026-06-13';
const LICE_A = 'lice-a';
const LICE_B = 'lice-b';

/** 5-minute slots from midnight, so the arithmetic in the tests is readable. */
const slotOf = (iso: string) => {
  const [h, m] = iso.slice(11, 16).split(':').map(Number);
  return (h! * 60 + m!) / 5;
};
const at = (hhmm: string) => `${DAY}T${hhmm}:00.000Z`;

const match = (
  id: string,
  liceId: string | null,
  hhmm: string | null,
  durationMinutes = 10,
): PlannableMatch => ({
  id,
  liceId,
  scheduledAt: hhmm ? at(hhmm) : null,
  durationMinutes,
});

describe('matchBelongsToDay', () => {
  it('compares the calendar date only', () => {
    expect(matchBelongsToDay(at('09:00'), DAY)).toBe(true);
    expect(matchBelongsToDay(at('23:59'), DAY)).toBe(true);
    expect(matchBelongsToDay('2026-06-14T09:00:00.000Z', DAY)).toBe(false);
  });

  it('treats an unscheduled match as belonging to no day', () => {
    expect(matchBelongsToDay(null, DAY)).toBe(false);
  });
});

describe('occupantsOnLice', () => {
  const board = [
    match('here', LICE_A, '09:00'),
    match('also-here', LICE_A, '09:30'),
    match('other-lice', LICE_B, '09:00'),
    match('other-day', LICE_A, '09:00'),
    match('unscheduled', null, null),
    match('dragged', LICE_A, '10:00'),
  ];
  board[3]!.scheduledAt = '2026-06-14T09:00:00.000Z';

  it('takes only the matches on that lice, on that day', () => {
    const out = occupantsOnLice({
      matches: board,
      liceId: LICE_A,
      day: DAY,
      excludeId: 'dragged',
      slotOf,
    });
    expect(out.map((o) => o.id).sort()).toEqual(['also-here', 'here']);
  });

  it('excludes the dragged match so it cannot collide with itself', () => {
    // Without this the cascade shoves the whole column down by one bout when a
    // match is dropped back onto its own lice.
    const out = occupantsOnLice({
      matches: board,
      liceId: LICE_A,
      day: DAY,
      excludeId: 'here',
      slotOf,
    });
    expect(out.map((o) => o.id)).not.toContain('here');
  });

  it('reports each occupant in slots and spans', () => {
    const out = occupantsOnLice({
      matches: [match('m', LICE_A, '09:00', 20)],
      liceId: LICE_A,
      day: DAY,
      excludeId: 'x',
      slotOf,
    });
    expect(out[0]).toEqual({ id: 'm', slot: slotOf(at('09:00')), span: 4 });
  });
});

describe('planMatchDrop', () => {
  const plan = (matches: PlannableMatch[], dropped: PlannableMatch, hhmm: string) =>
    planMatchDrop({
      matches,
      dropped,
      targetLiceId: LICE_A,
      slot: slotOf(at(hhmm)),
      day: DAY,
      gridEndSlot: slotOf(at('20:00')),
      slotOf,
    });

  it('places a match on an empty slot and moves nothing else', () => {
    const dropped = match('drag', LICE_B, '15:00');
    const out = plan([dropped, match('far', LICE_A, '09:00')], dropped, '11:00');
    expect(out).toEqual([{ id: 'drag', liceId: LICE_A, slot: slotOf(at('11:00')) }]);
  });

  it('cascades the occupant out of the way on a collision', () => {
    const dropped = match('drag', LICE_B, '15:00');
    const sitting = match('sitting', LICE_A, '09:00');
    const out = plan([dropped, sitting], dropped, '09:00');
    expect(out[0]).toEqual({ id: 'drag', liceId: LICE_A, slot: slotOf(at('09:00')) });
    expect(out.map((o) => o.id)).toContain('sitting');
    // The displaced match ends up strictly later, never on top of the new one.
    const displaced = out.find((o) => o.id === 'sitting')!;
    expect(displaced.slot).toBeGreaterThan(out[0]!.slot);
  });

  it('puts the dropped match first, so the caller can report it as the subject', () => {
    const dropped = match('drag', LICE_B, '15:00');
    const out = plan(
      [dropped, match('a', LICE_A, '09:00'), match('b', LICE_A, '09:10')],
      dropped,
      '09:00',
    );
    expect(out[0]!.id).toBe('drag');
  });

  it('lands everything it touched on the target lice', () => {
    const dropped = match('drag', LICE_B, '15:00');
    const out = plan(
      [dropped, match('a', LICE_A, '09:00'), match('b', LICE_A, '09:10')],
      dropped,
      '09:00',
    );
    for (const assignment of out) expect(assignment.liceId).toBe(LICE_A);
  });

  it('ignores matches on another lice or another day when cascading', () => {
    const dropped = match('drag', LICE_B, '15:00');
    const elsewhere = match('elsewhere', LICE_B, '09:00');
    const out = plan([dropped, elsewhere], dropped, '09:00');
    expect(out.map((o) => o.id)).toEqual(['drag']);
  });

  it('schedules a match that had no lice or time at all', () => {
    const dropped = match('fresh', null, null);
    const out = plan([dropped], dropped, '09:00');
    expect(out).toEqual([{ id: 'fresh', liceId: LICE_A, slot: slotOf(at('09:00')) }]);
  });

  it('does not double-book when a match is dropped onto its own lice', () => {
    // The dragged match must be excluded from its own collision check.
    const dropped = match('drag', LICE_A, '09:00');
    const out = plan([dropped, match('later', LICE_A, '11:00')], dropped, '09:05');
    expect(out.map((o) => o.id)).toEqual(['drag']);
  });
});
