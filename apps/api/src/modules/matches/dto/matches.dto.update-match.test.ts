import { describe, expect, it } from 'vitest';
import { UpdateMatchDto } from './matches.dto';

/**
 * `PATCH /matches/:id` used to write the legacy `matches.referee_id` from any
 * person id, of any Event, with no check. No screen sent it: referees are set
 * through the referee-role routes, which check who they name. The field is gone,
 * and the body is strict, so a client that still sends it is refused rather
 * than silently ignored.
 */
const schema = UpdateMatchDto.schema;
const LICE = '7dde6260-3b74-4cee-9881-a71e5922bb89';

describe('UpdateMatchDto', () => {
  it('accepts a Lice, or null to clear it', () => {
    expect(schema.safeParse({ liceId: LICE }).success).toBe(true);
    expect(schema.safeParse({ liceId: null }).success).toBe(true);
  });

  it('refuses a referee', () => {
    const result = schema.safeParse({ liceId: LICE, refereeId: LICE });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.code)).toEqual(['unrecognized_keys']);
  });
});
