import { describe, expect, it } from 'vitest';
import { CreateEventDto, UpdateEventDto } from './events.dto';

/**
 * An Event's zone decides every clock on it, so the door takes only an IANA name and stores its one
 * spelling (ruling 411 row C). "Paris time" used to be stored as given; every reader then fell back
 * to Paris.
 */
const event = {
  name: 'Fosse aux Lions',
  slug: 'fal-2027',
  startDate: '2027-03-13',
  endDate: '2027-03-14',
};
const NOT_A_ZONE: unknown[] = [
  'Paris time',
  'local',
  'system',
  'UTC+3',
  '+03:00',
  '-05:00',
  '',
  42,
];

const zoneOf = (result: { success: boolean; data?: { timezone?: string } }) =>
  result.success ? result.data?.timezone : 'refused';

describe('CreateEventDto: the zone', () => {
  const create = CreateEventDto.schema;

  it('takes a zone, in its one spelling', () => {
    expect(zoneOf(create.safeParse({ ...event, timezone: 'America/New_York' }))).toBe(
      'America/New_York',
    );
    expect(zoneOf(create.safeParse({ ...event, timezone: 'europe/paris' }))).toBe('Europe/Paris');
  });

  it('takes no zone: the Event is on Paris', () => {
    expect(zoneOf(create.safeParse(event))).toBeUndefined();
  });

  it.each(NOT_A_ZONE)('refuses %j', (timezone) => {
    expect(create.safeParse({ ...event, timezone }).success).toBe(false);
  });
});

describe('UpdateEventDto: the zone', () => {
  const update = UpdateEventDto.schema;

  it('takes a zone, in its one spelling', () => {
    expect(zoneOf(update.safeParse({ timezone: 'Asia/Tokyo' }))).toBe('Asia/Tokyo');
    expect(zoneOf(update.safeParse({ timezone: 'US/Eastern' }))).toBe('America/New_York');
  });

  it.each(NOT_A_ZONE)('refuses %j', (timezone) => {
    expect(update.safeParse({ timezone }).success).toBe(false);
  });
});
