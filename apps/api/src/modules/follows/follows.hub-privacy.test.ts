/**
 * Following a fighter from the People hub obeys their choice not to be followed (ruling 158).
 *
 * `POST /me/follows/by-global-person` wrote the directory follow whatever the person chose, and
 * skipped each Event one by one: Paul kept Léa in his Following tab after she said no. The choice is
 * one answer for her whole profile now (ruling 132), so the tap is refused before anything is
 * written, with the per-Event page's own code and words. Driven through the real privacy service
 * over seeded tables.
 */
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, queriedTables } from '../../common/testing/supabase-chain';
import { PrivacyService } from '../persons/privacy.service';
import { FollowsService, PREFERS_NOT_FOLLOWED } from './follows.service';

const LEA = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const MARC = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
const PAUL = '5d1c0f7e-2a8b-4c3d-9e6f-0a1b2c3d4e5f';

const live = (id: string, allowBeingFollowed: boolean) => ({
  id,
  deleted_at: null,
  merged_into_id: null,
  account_deleted_at: null,
  hide_workshops_publicly: false,
  allow_being_followed: allowBeingFollowed,
});

function hub() {
  const supabase = mockSupabase({
    global_persons: { rows: [live(LEA, false), live(MARC, true)] },
    persons: { data: [], error: null },
    directory_follows: { data: null, error: null },
  });
  const service = new FollowsService(
    supabase as never,
    new PrivacyService(supabase as never),
    { applyFollow: vi.fn() } as never,
    {} as never,
  );
  return { service, supabase };
}

describe('a hub follow of someone who prefers not to be followed (ruling 158)', () => {
  it('is refused with its own code, before anything is read of their Events or written', async () => {
    const { service, supabase } = hub();
    const refusal = await service
      .followAllEvents(LEA, { userId: PAUL })
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ForbiddenException);
    expect((refusal as ForbiddenException).getResponse()).toEqual({
      code: PREFERS_NOT_FOLLOWED,
      message: 'This person prefers not to be followed',
    });
    expect(supabase.writes).toEqual([]);
    expect(queriedTables(supabase.from)).not.toContain('persons');
  });

  it('is refused to a guest and to a signed-out caller alike', async () => {
    const { service } = hub();
    for (const identity of [{ guestSessionId: 'g1', guestEventId: 'e1' }, {}]) {
      await expect(service.followAllEvents(LEA, identity)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    }
  });

  it('still follows someone who accepts followers', async () => {
    const { service, supabase } = hub();
    await expect(service.followAllEvents(MARC, { userId: PAUL })).resolves.toMatchObject({
      following: true,
    });
    expect(supabase.writes.map((w) => w.table)).toEqual(['directory_follows']);
  });
});
