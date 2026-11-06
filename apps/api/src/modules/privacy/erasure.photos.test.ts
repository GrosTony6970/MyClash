import { describe, expect, it } from 'vitest';
import { mockSupabase, scopedTo, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { ErasureService } from './erasure.service';

/**
 * Ruling 462: a profile the super admin anonymises keeps no photo its account sent from the
 * personal space, since that photo shows the old name (and maybe the face). Photos are linked by
 * the account (`event_photos.uploader_user_id`), which the profile names in `claimed_by_user_id`.
 */
function anonymising(profile: Record<string, unknown>) {
  const supabase = mockSupabase({
    global_persons: { rows: [profile] },
    persons: { rows: [] },
    guest_sessions: { rows: [] },
    global_person_claim_tokens: { rows: [] },
    global_person_claim_requests: { rows: [] },
    directory_follows: { rows: [] },
    event_photos: { rows: [{ id: 'ph1', uploader_user_id: 'u1' }] },
  });
  return { supabase, run: () => new ErasureService(supabase as never).anonymiseGlobalPerson('g1') };
}

describe('ErasureService.anonymiseGlobalPerson and photos (ruling 462)', () => {
  it('deletes the photos the profile’s account sent', async () => {
    const { supabase, run } = anonymising({
      id: 'g1',
      slug: 'lea-martin',
      claimed_by_user_id: 'u1',
    });
    const result = await run();

    const deletes = writesTo(supabase, 'event_photos');
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.op).toBe('delete');
    expect(scopedTo(deletes[0], 'uploader_user_id')).toBe('u1');
    expect(result.counts['event_photos']).toBe(1);
    expect(selectsFor(supabase.from, 'global_persons')[0]).toBe('slug, claimed_by_user_id');
  });

  it('a failed read of the profile stops it, before anything is renamed', async () => {
    const supabase = mockSupabase({
      global_persons: { data: null, error: { message: 'boom' } },
      event_photos: { rows: [] },
    });
    await expect(new ErasureService(supabase as never).anonymiseGlobalPerson('g1')).rejects.toThrow(
      'boom',
    );
    expect(supabase.writes).toEqual([]);
  });

  it('an unclaimed profile deletes no photo', async () => {
    const { supabase, run } = anonymising({
      id: 'g1',
      slug: 'lea-martin',
      claimed_by_user_id: null,
    });
    const result = await run();

    expect(writesTo(supabase, 'event_photos')).toHaveLength(0);
    expect(result.counts).not.toHaveProperty('event_photos');
  });
});
