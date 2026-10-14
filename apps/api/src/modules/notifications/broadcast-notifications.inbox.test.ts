import { describe, expect, it, vi } from 'vitest';
import { BroadcastNotificationsService } from './broadcast-notifications.service';

/**
 * A person's inbox shows each message's time on its Event's clock (quick-win M5, operator
 * 2026-10-14), so the read carries the Event's zone. Every message has an Event (`event_id NOT
 * NULL`, migration 0021) and every Event a zone (`NOT NULL`, migration 0102).
 */

const RECIPIENT_ROW = {
  id: 'rcp-1',
  delivery_status: 'sent',
  delivered_at: '2026-10-14T07:12:30Z',
  event_broadcast_notifications: {
    id: 'bc-1',
    event_id: 'event-1',
    severity: 'warning',
    target_type: 'all',
    title: 'Piste 3 delayed',
    body: '20 minutes.',
    created_at: '2026-10-14T07:12:00Z',
    events: { slug: 'fal', name: 'FAL 2026', timezone: 'Europe/Lisbon' },
  },
};

function inboxRead() {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn().mockResolvedValue({ data: [RECIPIENT_ROW], error: null }),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  return { chain, supabase: { service: { from: vi.fn(() => chain) } } };
}

describe('BroadcastNotificationsService.listUserBroadcasts', () => {
  it("reads the Event's zone with its slug and name, and hands it on", async () => {
    const { chain, supabase } = inboxRead();
    const service = new BroadcastNotificationsService(supabase as never, {} as never, {} as never);

    const items = await service.listUserBroadcasts('user-1');

    expect(supabase.service.from).toHaveBeenCalledWith('event_broadcast_recipients');
    expect(chain.select).toHaveBeenCalledWith(
      'id, delivery_status, delivered_at, event_broadcast_notifications ( id, event_id, severity, target_type, title, body, created_at, events ( slug, name, timezone ) )',
    );
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(items).toEqual([
      {
        id: 'rcp-1',
        broadcastId: 'bc-1',
        eventId: 'event-1',
        eventSlug: 'fal',
        eventName: 'FAL 2026',
        eventTimezone: 'Europe/Lisbon',
        severity: 'warning',
        targetType: 'all',
        title: 'Piste 3 delayed',
        body: '20 minutes.',
        createdAt: '2026-10-14T07:12:00Z',
        deliveryStatus: 'sent',
        deliveredAt: '2026-10-14T07:12:30Z',
      },
    ]);
  });
});
