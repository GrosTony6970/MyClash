import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { queriedTables, writesTo } from '../../common/testing/supabase-chain';
import {
  EVENT,
  OTHER_EVENT,
  STAFF_REQ,
  USER,
  arrivedAt,
  moderation,
  photoRow,
  type ModerationSetup,
} from './testing/moderation-doubles';

/**
 * The moderators' gate (rulings 491-494): the club's admin as before, or else a platform super
 * admin, whose approve, Keep and delete are recorded in the audit log before they are made.
 */
const PHOTO = photoRow(0).id as string;
const superAdmin: ModerationSetup = {
  allowed: false,
  platformRole: 'super_admin',
  photos: [photoRow(0)],
};

describe('a club admin moderates as before', () => {
  it('passes without reading a platform role, and writes no audit row', async () => {
    const { organiser, supabase } = moderation({ photos: [photoRow(0)] });
    await organiser.approve(EVENT, PHOTO, USER);
    await organiser.remove(EVENT, PHOTO, USER);
    expect(queriedTables(supabase.from)).not.toContain('platform_roles');
    expect(writesTo(supabase, 'audit_log')).toEqual([]);
  });

  it("the staff `photos` job's writes leave no audit row either", async () => {
    const { service, supabase } = moderation({ photos: [photoRow(0)] });
    await service.approve(await service.eventForStaff(STAFF_REQ), PHOTO);
    await service.keep(await service.eventForStaff(STAFF_REQ), PHOTO, arrivedAt(0));
    await service.remove(await service.eventForStaff(STAFF_REQ), PHOTO);
    expect(writesTo(supabase, 'audit_log')).toEqual([]);
    expect(writesTo(supabase, 'event_photos')).toHaveLength(2);
    expect(queriedTables(supabase.from)).not.toContain('platform_roles');
  });
});

describe('a platform super admin who is not in the club', () => {
  it.each([
    ['approve', 'event_photo.approve', 'event_photos'],
    ['remove', 'event_photo.delete', 'event_photos'],
    ['keep', 'event_photo.keep', 'event_photo_reports'],
  ] as const)('%s writes one audit row, BEFORE the change', async (call, action, changed) => {
    const { organiser, supabase } = moderation(superAdmin);
    if (call === 'keep') await organiser.keep(EVENT, PHOTO, USER, arrivedAt(0));
    else await organiser[call](EVENT, PHOTO, USER);

    const audit = writesTo(supabase, 'audit_log');
    expect(audit).toHaveLength(1);
    expect(audit[0]!.row).toEqual({
      actor_user_id: USER,
      action,
      entity_type: 'event',
      entity_id: EVENT,
      payload_json: { photoId: PHOTO, sentAt: arrivedAt(0) },
    });
    const order = supabase.writes.map((write) => write.table);
    expect(order.indexOf('audit_log')).toBeLessThan(order.indexOf(changed));
    expect(order.indexOf(changed)).toBeGreaterThan(-1);
  });

  it('reads the queue and its summary, and those reads write no audit row', async () => {
    const { organiser, supabase } = moderation(superAdmin);
    await expect(organiser.list(EVENT, USER, 'all')).resolves.toMatchObject({ next: null });
    await expect(organiser.summary(EVENT, USER)).resolves.toMatchObject({ waiting: 1 });
    expect(writesTo(supabase, 'audit_log')).toEqual([]);
  });

  it('a photo not in this Event is a 404, with no audit row and no change', async () => {
    const { organiser, supabase } = moderation({
      ...superAdmin,
      photos: [photoRow(0, { event_id: OTHER_EVENT })],
    });
    await expect(organiser.remove(EVENT, PHOTO, USER)).rejects.toMatchObject({ status: 404 });
    expect(supabase.writes).toEqual([]);
  });

  it('a failed audit write refuses the change with a 5xx, and the photo stays', async () => {
    const { organiser, supabase } = moderation({ ...superAdmin, auditFails: true });
    const failed = organiser.remove(EVENT, PHOTO, USER);
    await expect(failed).rejects.toThrow('audit write failed, event_photo.delete refused');
    await expect(failed).rejects.not.toBeInstanceOf(ForbiddenException);
    expect(writesTo(supabase, 'event_photos')).toEqual([]);
  });
});

describe('a club member below admin who is a super admin', () => {
  it('passes the platform way and is recorded', async () => {
    const tooLow = new ForbiddenException('Requires admin role or higher');
    const { organiser, supabase } = moderation({ ...superAdmin, refusal: tooLow });
    await organiser.approve(EVENT, PHOTO, USER);
    expect(writesTo(supabase, 'audit_log')).toHaveLength(1);
  });
});

describe('anyone else gets the club refusal back', () => {
  it.each([null, 'platform_admin', 'platform_viewer'])(
    'platform role %s: the same 403',
    async (role) => {
      const refusal = new ForbiddenException('You are not a member of this organization');
      const { organiser, supabase } = moderation({ ...superAdmin, platformRole: role, refusal });
      await expect(organiser.approve(EVENT, PHOTO, USER)).rejects.toBe(refusal);
      expect(supabase.writes).toEqual([]);
    },
  );

  it('a failed platform-role read is a 5xx, never a pass and never a 403', async () => {
    const { organiser, supabase } = moderation({ ...superAdmin, platformRole: 'read-fails' });
    const failed = organiser.approve(EVENT, PHOTO, USER);
    await expect(failed).rejects.toThrow('platform_roles down');
    await expect(failed).rejects.not.toBeInstanceOf(ForbiddenException);
    expect(supabase.writes).toEqual([]);
  });

  it('a club read that failed (not a 403) is rethrown without asking the platform role', async () => {
    const down = new Error('membership read failed: down');
    const { organiser, supabase } = moderation({ ...superAdmin, refusal: down });
    await expect(organiser.approve(EVENT, PHOTO, USER)).rejects.toBe(down);
    expect(queriedTables(supabase.from)).not.toContain('platform_roles');
  });
});

describe('the QR link and the zip stay the club’s (ruling 492)', () => {
  it("the organiser's gate refuses a super admin who is not in the club", async () => {
    const { service, supabase } = moderation(superAdmin);
    await expect(service.eventForOrganiser(EVENT, USER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(queriedTables(supabase.from)).not.toContain('platform_roles');
  });
});
