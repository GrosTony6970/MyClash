/**
 * An Event is announced to its organisation's followers once in its life. Claire published the
 * Winter Games last week and her 40 followers heard of it. Today she fixes a typo on the Events
 * list and saves: the form sends the Event's status with every save, so the server reads
 * `published` again. Only a compare-and-set on `first_published_at`, in SQL, may say "first
 * publish": the row the service read is no witness, and the test double hands back every seeded
 * column whatever the projection asked for, which is how a missing column hid this for months.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  scopedTo,
  writesTo,
  type RecordedWrite,
} from '../../common/testing/supabase-chain';
import { EventsService } from './events.service';

const EVENT = 'e-winter';

type Act = (s: EventsService) => Promise<unknown>;

function setup(status: string, firstPublishedAt: string | null) {
  const db = mockSupabase({
    events: {
      rows: [
        {
          id: EVENT,
          organization_id: 'org-a',
          status,
          event_kind: 'standard',
          first_published_at: firstPublishedAt,
        },
      ],
    },
    tournaments: { rows: [] },
  });
  const notificationEvents = {
    lockedDutiesPublished: vi.fn(),
    organizerPublishedEvent: vi.fn(),
  };
  const service = new EventsService(
    db as never,
    { assertOrgRole: vi.fn().mockResolvedValue(undefined) } as never,
    notificationEvents as never,
    {} as never,
  );
  return { db, service, notificationEvents };
}

const stamps = (write: RecordedWrite) =>
  Object.prototype.hasOwnProperty.call(write.row, 'first_published_at');
const onlyIfNeverPublished = (write: RecordedWrite) =>
  write.filters.some(
    (f) => f.method === 'is' && f.args[0] === 'first_published_at' && f.args[1] === null,
  );

const FORM_SAVE = { name: 'Winter Games', city: 'Lyon', status: 'published' } as const;

describe('an Event is announced once in its life', () => {
  // These three passed on the broken code too: the double handed the Event read the stamp it never
  // asked for. The last block, on the write's filter, is the one that went red.
  it.each<[string, string, string | null, Act]>([
    [
      'the edit form saving a published Event',
      'published',
      '2026-09-01T00:00:00Z',
      (s) => s.updateEvent(EVENT, FORM_SAVE, 'u'),
    ],
    [
      'the edit form publishing a draft published once before',
      'draft',
      '2026-09-01T00:00:00Z',
      (s) => s.updateEvent(EVENT, FORM_SAVE, 'u'),
    ],
    [
      'the Publish button on a draft published once before',
      'draft',
      '2026-09-01T00:00:00Z',
      (s) => s.publishEvent(EVENT, 'u'),
    ],
  ])('not by %s', async (_, status, firstPublishedAt, act) => {
    const { db, service, notificationEvents } = setup(status, firstPublishedAt);
    await act(service);
    expect(notificationEvents.organizerPublishedEvent).not.toHaveBeenCalled();
    // The save itself still lands, without touching the first-publish stamp.
    const plain = writesTo(db, 'events').filter((w) => !stamps(w));
    expect(plain).toHaveLength(1);
    expect(scopedTo(plain[0], 'id')).toBe(EVENT);
    expect(plain[0]!.row).toMatchObject({ status: 'published' });
  });

  it.each<[string, Act]>([
    [
      'the edit form publishing a draft never published',
      (s) => s.updateEvent(EVENT, FORM_SAVE, 'u'),
    ],
    ['the Publish button on a draft never published', (s) => s.publishEvent(EVENT, 'u')],
  ])('by %s, in one write', async (_, act) => {
    const { db, service, notificationEvents } = setup('draft', null);
    await act(service);
    expect(notificationEvents.organizerPublishedEvent.mock.calls).toEqual([[EVENT]]);
    const writes = writesTo(db, 'events');
    expect(writes).toHaveLength(1);
    const row = writes[0]!.row as Record<string, unknown>;
    expect(row).toMatchObject({ status: 'published', first_published_at: expect.any(String) });
    expect(row['first_published_at']).toBe(row['updated_at']);
  });

  it('not by a save that sends no status', async () => {
    const { db, service, notificationEvents } = setup('draft', null);
    await service.updateEvent(EVENT, { city: 'Lyon' }, 'u');
    expect(notificationEvents.organizerPublishedEvent).not.toHaveBeenCalled();
    expect(writesTo(db, 'events').filter(stamps)).toEqual([]);
  });

  it('a failed first write refuses the save, and announces nothing', async () => {
    const row = { id: EVENT, organization_id: 'org-a', status: 'draft', event_kind: 'standard' };
    // Canned, in call order: the Event read, the compare-and-set, then a write that would succeed.
    const db = mockSupabase({
      events: [
        { data: row, error: null },
        { data: null, error: { message: 'events write failed' } },
        { data: row, error: null },
      ],
    });
    const organizerPublishedEvent = vi.fn();
    const service = new EventsService(
      db as never,
      { assertOrgRole: vi.fn().mockResolvedValue(undefined) } as never,
      { organizerPublishedEvent, lockedDutiesPublished: vi.fn() } as never,
      {} as never,
    );
    await expect(service.updateEvent(EVENT, FORM_SAVE, 'u')).rejects.toThrow('events write failed');
    expect(organizerPublishedEvent).not.toHaveBeenCalled();
  });

  it.each<[string, string | null, Act]>([
    ['the edit form, never published', null, (s) => s.updateEvent(EVENT, FORM_SAVE, 'u')],
    [
      'the edit form, published before',
      '2026-09-01T00:00:00Z',
      (s) => s.updateEvent(EVENT, FORM_SAVE, 'u'),
    ],
    ['the Publish button, never published', null, (s) => s.publishEvent(EVENT, 'u')],
    [
      'the Publish button, published before',
      '2026-09-01T00:00:00Z',
      (s) => s.publishEvent(EVENT, 'u'),
    ],
  ])('%s: only SQL may stamp the first publish', async (_, firstPublishedAt, act) => {
    const { db, service } = setup('draft', firstPublishedAt);
    await act(service);
    const stamping = writesTo(db, 'events').filter(stamps);
    expect(stamping).toHaveLength(1);
    expect(stamping.every(onlyIfNeverPublished)).toBe(true);
    expect(scopedTo(stamping[0], 'id')).toBe(EVENT);
  });
});
