/**
 * A follow, a switch change and an unfollow each bring the follower's waiting alerts in line, at
 * once (operator rulings 207, 209).
 *
 * Marc follows Léa on Saturday morning; her bouts were timed on Friday. An alert used to be set
 * only when a bout's time changed, so he heard nothing. And his "tell me before her bouts" switch,
 * turned off at 09:50, left the 10:00 alert waiting.
 *
 * The service hands the scheduler the person and the follower only: the scheduler reads his
 * follows as saved, so every call here comes AFTER the write.
 */
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo, type TableSeed } from '../../common/testing/supabase-chain';
import { FollowsService } from './follows.service';

const EVENT = 'e1';
const LEA = 'p-lea';
const MARC = { userId: 'marc' };
const GUEST = { guestSessionId: 'guest-1', guestEventId: EVENT };
const ROW = {
  id: 'f1',
  followed_person_id: LEA,
  event_id: EVENT,
  created_at: '2026-09-25T00:00:00Z',
  notify_match_start: true,
  notify_workshop_start: false,
  persons: { given_name: 'Léa', family_name: 'Roux', clubs: { name: 'Salle' } },
};
const NONE = { data: null, error: null };
const saved = (row: Record<string, unknown>) => ({ data: row, error: null });

function build(follows: TableSeed) {
  const supabase = mockSupabase({ follows, registrations: { rows: [] } });
  // What was written to `follows` when the alerts were asked for: the alerts come after the write.
  const writesWhenAsked: number[] = [];
  const applyFollow = vi.fn(async () => {
    writesWhenAsked.push(writesTo(supabase, 'follows').length);
  });
  const service = new FollowsService(
    supabase as never,
    { forPerson: vi.fn().mockResolvedValue({ allowBeingFollowed: true }) } as never,
    { applyFollow } as never,
    {} as never,
  );
  return { service, supabase, applyFollow, writesWhenAsked };
}

describe("a follow sets the follower's alerts at once (ruling 207)", () => {
  it('a new follow asks for his alerts about her, once it is saved', async () => {
    const { service, applyFollow, writesWhenAsked } = build([NONE, saved(ROW)]);

    await service.follow(EVENT, LEA, MARC);

    expect(applyFollow.mock.calls).toEqual([[LEA, 'marc']]);
    expect(writesWhenAsked).toEqual([1]);
  });

  it('a follow that already exists asks again', async () => {
    const { service, applyFollow, writesWhenAsked } = build(saved(ROW));

    await service.follow(EVENT, LEA, MARC);

    expect(applyFollow.mock.calls).toEqual([[LEA, 'marc']]);
    expect(writesWhenAsked).toEqual([0]);
  });

  it('the loser of two racing follows asks too', async () => {
    const lost = { data: null, error: { code: '23505', message: 'duplicate key value' } };
    const { service, applyFollow } = build([NONE, lost, saved(ROW)]);

    await service.follow(EVENT, LEA, MARC);

    expect(applyFollow.mock.calls).toEqual([[LEA, 'marc']]);
  });

  it('a guest session has no account to tell: nothing is asked', async () => {
    const { service, applyFollow } = build([NONE, saved(ROW)]);

    await service.follow(EVENT, LEA, GUEST);

    expect(applyFollow).not.toHaveBeenCalled();
  });

  it('alerts that cannot be set fail the follow, which is saved; the same call again sets them', async () => {
    const { service, supabase, applyFollow } = build([NONE, saved(ROW), saved(ROW)]);
    applyFollow.mockRejectedValueOnce(new Error('Bouts of a followed person unreadable: boom'));

    await expect(service.follow(EVENT, LEA, MARC)).rejects.toThrow('unreadable: boom');
    expect(writesTo(supabase, 'follows')).toHaveLength(1);

    await service.follow(EVENT, LEA, MARC);
    expect(applyFollow).toHaveBeenCalledTimes(2);
    expect(writesTo(supabase, 'follows')).toHaveLength(1);
  });
});

describe('a switch of a follow acts at once (ruling 209)', () => {
  it('a switch change asks for his alerts about her, once it is saved', async () => {
    const { service, applyFollow, writesWhenAsked } = build(
      saved({ ...ROW, notify_match_start: false }),
    );

    await service.updateNotifications(EVENT, LEA, MARC, { notifyMatchStart: false });

    expect(applyFollow.mock.calls).toEqual([[LEA, 'marc']]);
    expect(writesWhenAsked).toEqual([1]);
  });

  it('a switch change on a follow that is gone asks for nothing', async () => {
    const { service, applyFollow } = build(NONE);

    await expect(
      service.updateNotifications(EVENT, LEA, MARC, { notifyMatchStart: true }),
    ).rejects.toThrow('Follow not found');
    expect(applyFollow).not.toHaveBeenCalled();
  });

  it('an unfollow asks once the follow is deleted', async () => {
    const { service, applyFollow, writesWhenAsked } = build(NONE);

    await service.unfollow(EVENT, LEA, MARC);

    expect(applyFollow.mock.calls).toEqual([[LEA, 'marc']]);
    expect(writesWhenAsked).toEqual([1]);
  });

  it("a guest session's unfollow asks for nothing", async () => {
    const { service, applyFollow } = build(NONE);

    await service.unfollow(EVENT, LEA, GUEST);

    expect(applyFollow).not.toHaveBeenCalled();
  });
});
