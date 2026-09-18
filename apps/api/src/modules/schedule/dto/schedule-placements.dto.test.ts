import { describe, expect, it } from 'vitest';
import { PLACEMENTS_MAX, schedulePlacementsSchema } from './schedule-placements.dto';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LICE = '7dde6260-3b74-4cee-9881-a71e5922bb89';
// `+00:00`, not `Z`: the board hands on `scheduled_at` as PostgREST wrote it, and
// a `Z` time passes without `offset: true` too, so it would not hold the option.
const AT = '2026-06-06T08:43:00+00:00';
const place = (n: number) => ({ matchId: id(n), liceId: LICE, scheduledAt: AT });
const clear = (n: number) => ({ matchId: id(n), liceId: null, scheduledAt: null });

const refused = (body: unknown) => schedulePlacementsSchema.safeParse(body).success === false;

describe('schedulePlacementsSchema, the schedule board batch', () => {
  it('accepts placements and clears in one batch, as sent', () => {
    const body = { placements: [place(1), clear(2), place(3)] };

    expect(schedulePlacementsSchema.parse(body)).toEqual(body);
  });

  it('accepts half a placement, which undo sends to put a half-placed bout back', () => {
    // A bout can hold a piste with no time yet. Dragged from the Unscheduled
    // panel and undone, it goes back to exactly that.
    expect(refused({ placements: [place(1), { ...place(2), scheduledAt: null }] })).toBe(false);
    expect(refused({ placements: [place(1), { ...place(2), liceId: null }] })).toBe(false);
  });

  it('refuses a row with a key missing — null is how a row says "none"', () => {
    expect(refused({ placements: [{ matchId: id(1), liceId: LICE }] })).toBe(true);
    expect(refused({ placements: [{ matchId: id(1), scheduledAt: AT }] })).toBe(true);
  });

  it('refuses a key it does not know, on the body and on a row', () => {
    expect(refused({ placements: [place(1)], startAt: AT })).toBe(true);
    // No length: the run window is the one door that writes a bout's length.
    expect(refused({ placements: [{ ...place(1), plannedDurationOverrideMinutes: 7 }] })).toBe(
      true,
    );
  });

  it('refuses a Match named twice', () => {
    expect(refused({ placements: [place(1), clear(2), clear(1)] })).toBe(true);
  });

  it(`refuses no row, and more than ${PLACEMENTS_MAX}`, () => {
    expect(refused({ placements: [] })).toBe(true);
    const many = Array.from({ length: PLACEMENTS_MAX + 1 }, (_, n) => clear(n + 1));
    expect(refused({ placements: many })).toBe(true);
    expect(refused({ placements: many.slice(0, PLACEMENTS_MAX) })).toBe(false);
  });

  it('refuses a time with no offset, which the server would read in its own zone', () => {
    expect(refused({ placements: [{ ...place(1), scheduledAt: '2026-06-06T10:43:00' }] })).toBe(
      true,
    );
  });

  it('refuses an id that is not a uuid, and the empty strings the board once sent', () => {
    expect(refused({ placements: [{ ...place(1), matchId: 'm-1' }] })).toBe(true);
    expect(refused({ placements: [{ matchId: id(1), liceId: '', scheduledAt: '' }] })).toBe(true);
  });
});
