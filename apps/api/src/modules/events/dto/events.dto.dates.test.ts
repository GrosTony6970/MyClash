import { describe, expect, it } from 'vitest';
import { CreateEventDto, EventQueryDto, UpdateEventDto } from './events.dto';

/**
 * An Event's dates are real days (O6, migration 0223 makes them DATE). Free text such as "next
 * Tuesday" or a day that does not exist was stored as given, and every reader that casts the column
 * would then fail; the end may not come before the start.
 */
const event = { name: 'Fosse aux Lions', slug: 'fal-2027', startDate: '2027-03-13' };

describe('CreateEventDto: the dates', () => {
  const create = CreateEventDto.schema;

  it('takes a one-day and a two-day Event', () => {
    expect(create.safeParse({ ...event, endDate: '2027-03-13' }).success).toBe(true);
    expect(create.safeParse({ ...event, endDate: '2027-03-14' }).success).toBe(true);
  });

  it('refuses free text, a day that does not exist, and a full timestamp', () => {
    for (const endDate of ['next Tuesday', '2027-02-30', '2027-03-14T10:00:00Z', '14/03/2027']) {
      expect(create.safeParse({ ...event, endDate }).success).toBe(false);
    }
  });

  it('refuses an end before the start', () => {
    const parsed = create.safeParse({ ...event, endDate: '2027-03-12' });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe('The Event cannot end before it starts');
  });
});

describe('UpdateEventDto: the dates', () => {
  const update = UpdateEventDto.schema;

  it('takes one end alone (the service checks it against the stored other end)', () => {
    expect(update.safeParse({ endDate: '2027-03-12' }).success).toBe(true);
    expect(update.safeParse({ startDate: '2027-03-15' }).success).toBe(true);
  });

  it('refuses a pair whose end comes before its start, and a day that does not exist', () => {
    expect(update.safeParse({ startDate: '2027-03-14', endDate: '2027-03-13' }).success).toBe(
      false,
    );
    expect(update.safeParse({ startDate: '2027-02-29' }).success).toBe(false);
  });
});

describe('EventQueryDto: the date filters', () => {
  const query = EventQueryDto.schema;

  it('refuses a day that does not exist rather than failing the read on the DATE column', () => {
    for (const key of ['from', 'to', 'cursor']) {
      expect(query.safeParse({ [key]: '2027-03-14' }).success).toBe(true);
      expect(query.safeParse({ [key]: '2027-02-30' }).success).toBe(false);
    }
  });
});
