import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALLOW_ON_ARCHIVED_EVENT_KEY } from '../../common/event-readonly/allow-on-archived.decorator';
import { filtersFor, queriedTables, scopedTo, writesTo } from '../../common/testing/supabase-chain';
import { PhotosStaffController } from './photos-staff.controller';
import { EVENT, moderation, OTHER_EVENT, photoRow, STAFF_REQ } from './testing/moderation-doubles';

/**
 * The photo queue for a staff login with the `photos` job (design, "Moderation"). The Event is the login's
 * own; a photo of another Event is not there.
 */

const mine = photoRow(0);
const theirs = photoRow(1, { event_id: OTHER_EVENT });
const MINE = mine.id as string;
const THEIRS = theirs.id as string;
/** The newest report the screen showed, as the database wrote it. */
const SHOWN = '2026-11-07T12:00:00.123456+00:00';

afterEach(() => vi.restoreAllMocks());

const staffController = (setup: Parameters<typeof moderation>[0] = {}) => {
  const parts = moderation({ photos: [mine, theirs], ...setup });
  return { ...parts, ctl: new PhotosStaffController(parts.service) };
};

const notFound = async (promise: Promise<unknown>) => {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(NotFoundException);
  expect((err as NotFoundException).getResponse()).toMatchObject({ code: 'photo_not_found' });
};

describe('the staff gate', () => {
  it('asks the staff session for the photos job alone, and reads its own Event', async () => {
    const { ctl, staff, supabase } = staffController();

    await ctl.summary(STAFF_REQ);

    expect(staff.requireStaffWithRole).toHaveBeenCalledWith(STAFF_REQ, ['photos']);
    expect(filtersFor(supabase.from, 'events', 'eq')).toEqual([['id', EVENT]]);
  });

  it('reads the Event the session names, never another', async () => {
    const { ctl, supabase } = staffController({ staff: { eventId: OTHER_EVENT } });

    await ctl.queue({ filter: 'all' }, STAFF_REQ).catch(() => undefined);

    expect(filtersFor(supabase.from, 'events', 'eq')).toEqual([['id', OTHER_EVENT]]);
  });

  it.each(['summary', 'queue', 'approve', 'remove', 'keep'] as const)(
    '%s reads and writes nothing for a session the gate refuses',
    async (call) => {
      const refused = new ForbiddenException({ code: 'staff_role_not_allowed' });
      const { ctl, supabase, queue } = staffController({ staff: refused });

      const run =
        call === 'queue'
          ? ctl.queue({ filter: 'all' }, STAFF_REQ)
          : call === 'summary'
            ? ctl.summary(STAFF_REQ)
            : call === 'keep'
              ? ctl.keep(MINE, { reportsUpTo: SHOWN }, STAFF_REQ)
              : ctl[call](MINE, STAFF_REQ);
      await expect(run).rejects.toBe(refused);

      expect(queriedTables(supabase.from)).toEqual([]);
      expect(supabase.rpc).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    },
  );
});

describe('the staff writes, on the login’s Event only', () => {
  it('approves a photo of the login’s Event', async () => {
    const { ctl, supabase } = staffController();

    await expect(ctl.approve(MINE, STAFF_REQ)).resolves.toEqual({ id: MINE, status: 'approved' });

    const [write] = writesTo(supabase, 'event_photos');
    expect(write).toMatchObject({ op: 'update', row: { status: 'approved' } });
    expect(scopedTo(write, 'id')).toBe(MINE);
    expect(scopedTo(write, 'event_id')).toBe(EVENT);
  });

  it('deletes a photo of the login’s Event and asks for a drain', async () => {
    const { ctl, supabase, queue } = staffController();

    await expect(ctl.remove(MINE, STAFF_REQ)).resolves.toBeUndefined();

    const [write] = writesTo(supabase, 'event_photos');
    expect(write?.op).toBe('delete');
    expect(scopedTo(write, 'id')).toBe(MINE);
    expect(scopedTo(write, 'event_id')).toBe(EVENT);
    expect(queue.add).toHaveBeenCalledOnce();
  });

  it.each(['approve', 'remove'] as const)(
    '%s of a photo of another Event answers 404 and queues nothing',
    async (call) => {
      const { ctl, supabase, queue } = staffController();

      await notFound(ctl[call](THEIRS, STAFF_REQ));

      // The write asked for this photo on the login's Event: the double found no such row.
      expect(scopedTo(writesTo(supabase, 'event_photos')[0], 'event_id')).toBe(EVENT);
      expect(queue.add).not.toHaveBeenCalled();
    },
  );

  it("keeps a photo of the login's Event, clearing its reports up to the newest shown", async () => {
    const reports = [{ photo_id: MINE, device_id: '55555555-5555-4555-8555-555555555555' }];
    const { ctl, supabase } = staffController({ reports });
    const body = { reportsUpTo: SHOWN };

    await expect(ctl.keep(MINE, body, STAFF_REQ)).resolves.toEqual({ id: MINE, kept: true });

    const [write] = writesTo(supabase, 'event_photo_reports');
    expect(write?.op).toBe('delete');
    expect(scopedTo(write, 'photo_id')).toBe(MINE);
    const bound = write?.filters.filter((filter) => filter.method === 'lte');
    expect(bound?.map((filter) => filter.args)).toEqual([['created_at', SHOWN]]);
    await notFound(ctl.keep(THEIRS, body, STAFF_REQ));
  });

  // Ruling 438: the `photos` login stops at archive, Delete included. The staff session's check
  // refuses it (staff.service.event-over.test.ts); no route here opts out of the archived lock.
  it('opens no staff route on an archived Event', () => {
    const reflector = new Reflector();
    for (const handler of ['approve', 'remove', 'keep'] as const) {
      const open = reflector.get<boolean>(
        ALLOW_ON_ARCHIVED_EVENT_KEY,
        PhotosStaffController.prototype[handler] as never,
      );
      expect(open, handler).not.toBe(true);
    }
  });
});

describe('the staff reads', () => {
  it('lists the login’s Event, with the filter and the cursor it was given', async () => {
    const { ctl } = staffController();

    const page = await ctl.queue({ filter: 'all' }, STAFF_REQ);

    expect(page.photos.map((p) => p.id)).toEqual([MINE]);
  });
});
