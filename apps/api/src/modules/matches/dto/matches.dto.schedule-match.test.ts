import { describe, expect, it } from 'vitest';
import { ScheduleMatchDto } from './matches.dto';

/**
 * `PATCH /matches/:id/schedule` unschedules a Match when both fields are null.
 *
 * The schedule board sent `''` for both instead, from the × on a run, the run
 * header's Clear, a card dropped on the Unscheduled panel and undo. The service
 * turns `''` into null on its own, so that worked until this DTO was put in
 * front of it — and an empty string is neither a uuid nor a date, so every one of
 * those saves was refused. The board's side is `tests/drag/unschedule.spec.ts`.
 */
const schema = ScheduleMatchDto.schema;
const LICE = '7dde6260-3b74-4cee-9881-a71e5922bb89';

describe('ScheduleMatchDto', () => {
  it('unschedules with null for both fields', () => {
    expect(schema.safeParse({ liceId: null, scheduledAt: null })).toEqual({
      success: true,
      data: { liceId: null, scheduledAt: null },
    });
  });

  it('places with a Lice and a time in the offset form the board reads back', () => {
    // `+00:00`, not `Z`: the grid hands on `scheduled_at` as PostgREST wrote it
    // (schedule-grid.service.ts), and undo sends that string back. A `Z` time
    // passes without `offset: true` too, so it would not hold the option.
    const body = { liceId: LICE, scheduledAt: '2026-06-06T08:00:00+00:00' };

    expect(schema.safeParse(body)).toEqual({ success: true, data: body });
  });

  it('refuses the empty strings the board used to send', () => {
    const result = schema.safeParse({ liceId: '', scheduledAt: '' });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.map((issue) => ({
        path: issue.path,
        code: issue.code,
        format: 'format' in issue ? issue.format : undefined,
      })),
    ).toEqual([
      { path: ['liceId'], code: 'invalid_format', format: 'uuid' },
      { path: ['scheduledAt'], code: 'invalid_format', format: 'datetime' },
    ]);
  });

  it('refuses an unknown key', () => {
    const result = schema.safeParse({
      liceId: LICE,
      scheduledAt: '2026-06-06T08:00:00.000Z',
      durationMinutes: 7,
    });

    expect(result.error?.issues.map((issue) => issue.code)).toEqual(['unrecognized_keys']);
  });
});
