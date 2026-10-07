import { describe, expect, it } from 'vitest';
import { UpdateMatchStatusDto } from './matches.dto';

/**
 * `PATCH /matches/:id/status` writes the status and keeps the fight: the hits, the
 * score and the start time stay (the winner goes, ruling 331). Sent `scheduled`, it left a fought bout that
 * read unplayed, and the doors that ask the owner before they delete fought
 * bouts let it go. A bout goes back to unplayed by a reset only, which clears
 * what was fought (ruling 281).
 */
const schema = UpdateMatchStatusDto.schema;

describe('UpdateMatchStatusDto', () => {
  it.each<'running' | 'paused' | 'completed'>(['running', 'paused', 'completed'])(
    'accepts %s',
    (status) => {
      expect(schema.safeParse({ status }).success).toBe(true);
    },
  );

  it('refuses scheduled', () => {
    const result = schema.safeParse({ status: 'scheduled' });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['status']]);
  });

  it('refuses voided, which has its own route', () => {
    expect(schema.safeParse({ status: 'voided' }).success).toBe(false);
  });
});
