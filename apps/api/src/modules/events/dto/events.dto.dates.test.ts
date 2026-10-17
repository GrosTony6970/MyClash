import { describe, expect, it } from 'vitest';
import { CreateEventDto, EventQueryDto, UpdateEventDto } from './events.dto';

/**
 * An Event's dates are calendar days (O6, migration 0223 makes them DATE). Free text such as "next
 * Tuesday" or a day that does not exist was stored as given, and every reader that casts the column
 * would then fail. Each date field takes a day Postgres takes; the ORDER of the two days is the
 * service's (`createEvent`, `updateEvent`), so both refusals say the same sentence.
 */
const event = { name: 'Fosse aux Lions', slug: 'fal-2027', startDate: '2027-03-13' };
const NOT_A_DAY = [
  'next Tuesday',
  '2027-02-30',
  '0000-01-01',
  '2027-03-14T10:00:00Z',
  '14/03/2027',
];

describe('CreateEventDto: the dates', () => {
  const create = CreateEventDto.schema;

  it('takes a one-day and a two-day Event', () => {
    expect(create.safeParse({ ...event, endDate: '2027-03-13' }).success).toBe(true);
    expect(create.safeParse({ ...event, endDate: '2027-03-14' }).success).toBe(true);
  });

  it('refuses free text, a day that does not exist, year 0000 and a full timestamp', () => {
    for (const endDate of NOT_A_DAY) {
      expect(create.safeParse({ ...event, endDate }).success).toBe(false);
    }
  });
});

describe('UpdateEventDto: the dates', () => {
  const update = UpdateEventDto.schema;

  it('takes either end alone, or a pair (the service checks their order)', () => {
    expect(update.safeParse({ endDate: '2027-03-12' }).success).toBe(true);
    expect(update.safeParse({ startDate: '2027-03-15', endDate: '2027-03-14' }).success).toBe(true);
  });

  it('refuses a day that is not a calendar day', () => {
    for (const startDate of NOT_A_DAY) {
      expect(update.safeParse({ startDate }).success).toBe(false);
    }
  });
});

describe('EventQueryDto: the date filters', () => {
  const query = EventQueryDto.schema;

  it('refuses a day Postgres would refuse, rather than failing the read on the DATE column', () => {
    for (const key of ['from', 'to', 'cursor']) {
      expect(query.safeParse({ [key]: '2027-03-14' }).success).toBe(true);
      expect(query.safeParse({ [key]: '9999-12-31' }).success).toBe(true);
      expect(query.safeParse({ [key]: '2027-02-30' }).success).toBe(false);
      expect(query.safeParse({ [key]: '0000-01-01' }).success).toBe(false);
    }
  });
});
