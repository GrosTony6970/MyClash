import { describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { MeController } from './me.controller';

/** `GET me/events` carries, per Event, whether she has photos there (slice 6, the Photos tab). */
describe('MeController.events — her photos per Event', () => {
  it('marks an Event where she sent a photo from her personal space', async () => {
    const db = mockSupabase({
      event_photos: { rows: [{ id: 'ph-1', event_id: 'e-1', uploader_user_id: 'uid-1' }] },
    });
    const supabase = { ...db, getAuthUser: vi.fn(async (token: string) => ({ id: token })) };
    const listed = [{ event: { id: 'e-1', endDate: null, timezone: 'UTC' } }];
    const me = { listMyEvents: vi.fn(async () => listed) };
    const controller = new MeController(me as never, supabase as never);

    const events = await controller.events({
      headers: { authorization: 'Bearer uid-1' },
      cookies: {},
    } as never);

    expect(me.listMyEvents).toHaveBeenCalledWith({ userId: 'uid-1', staff: null });
    expect(events).toEqual([{ ...listed[0], hasMyPhotos: true }]);
  });
});
