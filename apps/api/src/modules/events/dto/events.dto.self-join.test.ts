import { describe, expect, it } from 'vitest';
import { UpdateEventDto } from './events.dto';

/** The join switch of ruling 516: on or off, nothing else. */
const update = UpdateEventDto.schema;

describe('UpdateEventDto — workshopSelfJoin', () => {
  it.each([true, false])('takes %j', (workshopSelfJoin) => {
    expect(update.parse({ workshopSelfJoin })).toEqual({ workshopSelfJoin });
  });

  it.each(['true', 1, null, 'open'])('refuses %j', (workshopSelfJoin) => {
    expect(update.safeParse({ workshopSelfJoin }).success).toBe(false);
  });
});
