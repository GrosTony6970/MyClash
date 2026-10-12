import { describe, expect, it } from 'vitest';
import { LevelPressDto } from './matches.dto';

/**
 * The exact body the scoring pad posts for a queued step of a level bout
 * (`levelPressBody` in `apps/web-staff/src/offline/press-send.ts`; the pad's
 * own test `sync.level.test.ts` pins the same five keys).
 *
 * The pad's browser tests run on a stubbed server, which takes any body. A key
 * the strict schema refuses would be a 400 at a venue, and the pad holds a
 * step at its first 400 with the rest of its bout behind it.
 */
const schema = LevelPressDto.schema;

const body = {
  clientUuid: '7dde6260-3b74-4cee-9881-a71e5922bb89',
  round: 1,
  step: 0,
  pressedAt: '2026-10-10T10:00:00.000Z',
  sentAt: '2026-10-10T10:20:00.000Z',
};

describe('LevelPressDto: the body the scoring pad sends', () => {
  it('takes "Extra time", the first step of a round, as the pad builds it', () => {
    const result = schema.safeParse(body);
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it('takes "Sudden death", the second step, in a later round', () => {
    expect(schema.safeParse({ ...body, round: 2, step: 1 }).success).toBe(true);
  });

  it('refuses a sixth key: what the step is, and the time it gives, stay on the tablet', () => {
    expect(schema.safeParse({ ...body, kind: 'extra_time' }).success).toBe(false);
    expect(schema.safeParse({ ...body, activeMs: 30_000 }).success).toBe(false);
  });
});
