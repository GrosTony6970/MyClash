import { Logger, NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scopedTo, writesTo } from '../../common/testing/supabase-chain';
import { EVENT, moderation, OTHER_EVENT, photoRow, USER } from './testing/moderation-doubles';

/**
 * The organiser's moderation queue, write side: approve and delete. Every write is scoped to the
 * photo AND its Event, so a photo id from another Event changes nothing.
 */

const mine = photoRow(0);
const theirs = photoRow(1, { event_id: OTHER_EVENT });
const MINE = mine.id as string;
const THEIRS = theirs.id as string;

afterEach(() => vi.restoreAllMocks());

const notFound = async (promise: Promise<unknown>) => {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(NotFoundException);
  expect((err as NotFoundException).getResponse()).toMatchObject({ code: 'photo_not_found' });
};

describe('the organiser gate', () => {
  it.each(['approve', 'remove'] as const)(
    '%s refuses a non-admin and writes nothing',
    async (call) => {
      const { organiser, supabase, queue } = moderation({ allowed: false, photos: [mine] });

      await expect(organiser[call](EVENT, MINE, USER)).rejects.toThrow('Not an admin of this club');

      expect(writesTo(supabase, 'event_photos')).toEqual([]);
      expect(queue.add).not.toHaveBeenCalled();
    },
  );
});

describe('approve', () => {
  it('approves the photo of this Event', async () => {
    const { organiser, supabase } = moderation({ photos: [mine, theirs] });

    await expect(organiser.approve(EVENT, MINE, USER)).resolves.toEqual({
      id: MINE,
      status: 'approved',
    });

    const [write] = writesTo(supabase, 'event_photos');
    expect(write).toMatchObject({ op: 'update', row: { status: 'approved' } });
    expect(scopedTo(write, 'id')).toBe(MINE);
    expect(scopedTo(write, 'event_id')).toBe(EVENT);
  });

  it("answers photo_not_found for another Event's photo", async () => {
    const { organiser } = moderation({ photos: [mine, theirs] });
    await notFound(organiser.approve(EVENT, THEIRS, USER));
  });
});

describe('remove', () => {
  it('deletes the photo of this Event and asks for a drain now', async () => {
    const { organiser, supabase, queue } = moderation({ photos: [mine, theirs] });

    await organiser.remove(EVENT, MINE, USER);

    const [write] = writesTo(supabase, 'event_photos');
    expect(write?.op).toBe('delete');
    expect(scopedTo(write, 'id')).toBe(MINE);
    expect(scopedTo(write, 'event_id')).toBe(EVENT);
    expect(queue.add).toHaveBeenCalledOnce();
    expect(queue.add).toHaveBeenCalledWith(
      'drain',
      {},
      { removeOnComplete: true, removeOnFail: { age: 86_400, count: 100 } },
    );
  });

  it("answers photo_not_found for another Event's photo, or one already gone, and queues nothing", async () => {
    const { organiser, queue } = moderation({ photos: [mine, theirs] });
    await notFound(organiser.remove(EVENT, THEIRS, USER));

    const gone = moderation({ photos: [] });
    await notFound(gone.organiser.remove(EVENT, MINE, USER));

    expect(queue.add).not.toHaveBeenCalled();
    expect(gone.queue.add).not.toHaveBeenCalled();
  });

  it('still deletes when the drain cannot be queued, and says so in the log', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { organiser, supabase } = moderation({
      photos: [mine],
      add: async () => {
        throw new Error('Redis is down');
      },
    });

    await expect(organiser.remove(EVENT, MINE, USER)).resolves.toBeUndefined();
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Redis is down')),
    );
    expect(writesTo(supabase, 'event_photos')).toHaveLength(1);
  });

  it('does not wait for a queue that never answers', async () => {
    const { organiser } = moderation({ photos: [mine], add: () => new Promise(() => undefined) });
    await expect(organiser.remove(EVENT, MINE, USER)).resolves.toBeUndefined();
  });
});
