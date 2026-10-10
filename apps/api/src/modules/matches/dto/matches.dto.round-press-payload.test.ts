import { describe, expect, it } from 'vitest';
import { RoundPressDto } from './matches.dto';

/**
 * The exact body the scoring pad posts for a queued "Start round N" or "End
 * round" (`roundPressBody` in `apps/web-staff/src/offline/press-send.ts`; the
 * pad's own test `sync.round.test.ts` pins the same four keys).
 *
 * The pad's browser tests run on a stubbed server, which takes any body. A key
 * the strict schema refuses would be a 400 at a venue, and the pad holds a
 * round press at its first 400 with the rest of its bout behind it.
 */
const schema = RoundPressDto.schema;

const body = {
  clientUuid: '7dde6260-3b74-4cee-9881-a71e5922bb89',
  round: 2,
  pressedAt: '2026-10-10T10:00:00.000Z',
  sentAt: '2026-10-10T10:20:00.000Z',
};

describe('RoundPressDto: the body the scoring pad sends', () => {
  it('takes "Start round 2" as the pad builds it', () => {
    const result = schema.safeParse(body);
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it('takes "End round 1": the same four keys, with the round it ends', () => {
    expect(schema.safeParse({ ...body, round: 1 }).success).toBe(true);
  });

  it('refuses a fifth key: the score an "End round" was pressed on stays on the tablet', () => {
    expect(schema.safeParse({ ...body, endScore: { red: 3, blue: 2 } }).success).toBe(false);
    expect(schema.safeParse({ ...body, action: 'advance' }).success).toBe(false);
  });
});
