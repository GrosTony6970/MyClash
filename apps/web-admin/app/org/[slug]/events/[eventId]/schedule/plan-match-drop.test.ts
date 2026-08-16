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
/**
 * The existing cases below build their instants as `…T{hh:mm}Z`, so they are
 * stated in UTC and read the same under any runner. Passing `'UTC'` keeps every
 * one of them meaning exactly what it meant before `matchBelongsToDay` learned
 * about zones. The zone-sensitive cases are their own block at the end, and they
 * deliberately do NOT use this constant.
 */
const TZ = 'UTC';

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
    expect(matchBelongsToDay(at('09:00'), DAY, TZ)).toBe(true);
    expect(matchBelongsToDay(at('23:59'), DAY, TZ)).toBe(true);
    expect(matchBelongsToDay('2026-06-14T09:00:00.000Z', DAY, TZ)).toBe(false);
  });

  it('treats an unscheduled match as belonging to no day', () => {
    expect(matchBelongsToDay(null, DAY, TZ)).toBe(false);
  });
});

/**
 * The day a bout belongs to is the EVENT's day, not the UTC day.
 *
 * These use `America/Los_Angeles` on purpose, and neither of CI's two legs can
 * stand in for it. The suite runs under `TZ=UTC` and `TZ=Europe/Paris`; UTC
 * cannot see the bug at all, and Paris — which is also the default zone, the
 * fixture zone and the dev box zone — only breaks between 00:00 and 02:00 local,
 * which no real schedule reaches. A negative offset moves the boundary into the
 * middle of a competition day: at UTC−7, 17:00 local is midnight UTC, so an
 * afternoon bout used to file under tomorrow.
 *
 * Restore `scheduledAtIso.slice(0, 10)` and only this block reds. That contrast
 * is the point — it is why the fix needed a third zone to be provable.
 */
describe('matchBelongsToDay across the local midnight boundary', () => {
  const LA = 'America/Los_Angeles';

  it('keeps a late-afternoon bout on its own local day', () => {
    // 2026-06-13 17:30 in Los Angeles (PDT, UTC−7) is 00:30Z on the 14th.
    expect(matchBelongsToDay('2026-06-14T00:30:00.000Z', '2026-06-13', LA)).toBe(true);
    expect(matchBelongsToDay('2026-06-14T00:30:00.000Z', '2026-06-14', LA)).toBe(false);
  });

  it('keeps a bout just after local midnight on the new local day', () => {
    // 2026-06-14 00:30 in Los Angeles is 07:30Z on the 14th — same date in UTC,
    // so this one is the case the old code got right. It is here so the pair
    // pins both sides of the boundary rather than only the half that moved.
    expect(matchBelongsToDay('2026-06-14T07:30:00.000Z', '2026-06-14', LA)).toBe(true);
  });

  it('keeps a bout just after midnight in a positive offset on the new local day', () => {
    // 2026-06-14 00:30 in Paris (CEST, UTC+2) is 22:30Z on the 13th — the
    // original report, and the mirror image of the Los Angeles case.
    expect(matchBelongsToDay('2026-06-13T22:30:00.000Z', '2026-06-14', 'Europe/Paris')).toBe(true);
    expect(matchBelongsToDay('2026-06-13T22:30:00.000Z', '2026-06-13', 'Europe/Paris')).toBe(false);
  });

  it('treats an unreadable timestamp as belonging to no day', () => {
    expect(matchBelongsToDay('not-a-date', DAY, LA)).toBe(false);
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
      tz: TZ,
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
      tz: TZ,
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
      tz: TZ,
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
      tz: TZ,
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
