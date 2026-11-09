/**
 * A cancelled session does nothing (operator rulings 526-529).
 *
 * "Longsword basics" runs Saturday and Sunday; Saturday was cancelled, its bookings kept. The pages
 * now show Saturday struck through, so it must be inert: it is not moved (its people would be told
 * it moved), nobody is promoted into it from its waitlist, and deleting it (the form's ✕, 527) does
 * not tell its people a second time.
 *
 * Driven through the real services over seeded tables, so the status read is applied, not asked.
 */
import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { EnrollmentService } from './enrollment.service';
import { WorkshopsService } from './workshops.service';

const EVENT = '11111111-1111-4111-8111-111111111111';
const WORKSHOP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SATURDAY = '33333333-3333-4333-8333-333333333333';
const LEAD = 'u-lead';

function tables(status: string) {
  return mockSupabase({
    events: { rows: [{ id: EVENT, organization_id: 'org-a', status: 'published' }] },
    workshops: { rows: [{ id: WORKSHOP, event_id: EVENT, capacity: 1, status: 'published' }] },
    workshop_sessions: {
      rows: [{ id: SATURDAY, workshop_id: WORKSHOP, status, venue_id: 'venue-a1', area_id: null }],
    },
    venues: {
      rows: [
        { id: 'venue-a1', organization_id: 'org-a' },
        { id: 'venue-a2', organization_id: 'org-a' },
      ],
    },
    venue_areas: { rows: [] },
    organization_members: {
      rows: [{ organization_id: 'org-a', user_id: LEAD, role: 'workshop_lead' }],
    },
    workshop_enrollments: {
      rows: [
        {
          id: 'e-alice',
          workshop_session_id: SATURDAY,
          user_id: 'alice',
          status: 'confirmed',
          position: null,
        },
        {
          id: 'e-bob',
          workshop_session_id: SATURDAY,
          user_id: 'bob',
          status: 'waitlisted',
          position: 1,
        },
      ],
    },
  });
}

function workshops(status: string) {
  const db = tables(status);
  const notices = { workshopCancelled: vi.fn(async () => undefined) };
  const scheduler = {
    scheduleWorkshopSessionStarting: vi.fn(async () => undefined),
    scheduleWorkshopMoved: vi.fn(async () => undefined),
  };
  const service = new WorkshopsService(
    { service: db.service } as never,
    scheduler as never,
    notices as never,
    new OrganizationsService({ service: db.service } as never),
    {} as never,
    { scheduleWorkshopStarting: vi.fn(async () => undefined) } as never,
  );
  return { db, notices, scheduler, service };
}

function enrollments(status: string) {
  const db = tables(status);
  const promoted = vi.fn(async () => undefined);
  const service = new EnrollmentService(
    { service: db.service } as never,
    { waitlistPromoted: promoted } as never,
    {
      scheduleWorkshopSessionStarting: vi.fn().mockResolvedValue(undefined),
      cancelWorkshopSessionStarting: vi.fn().mockResolvedValue(undefined),
    } as never,
  );
  return { db, promoted, service };
}

async function refusedAsCancelled(action: Promise<unknown>) {
  const refusal = await action.catch((err: unknown) => err);
  expect(refusal).toBeInstanceOf(ConflictException);
  expect((refusal as ConflictException).getResponse()).toMatchObject({
    error: 'WorkshopSessionCancelled',
  });
}

describe('a cancelled session is not moved', () => {
  it('refuses a new room, writing nothing and telling nobody it moved', async () => {
    const { db, scheduler, service } = workshops('cancelled');
    await refusedAsCancelled(service.updateSession(SATURDAY, { venueId: 'venue-a2' }, LEAD));
    expect(writesTo(db, 'workshop_sessions')).toEqual([]);
    expect(scheduler.scheduleWorkshopMoved).not.toHaveBeenCalled();
    // The double ignores the projection: only this holds the column the refusal reads.
    expect(selectsFor(db.from, 'workshop_sessions')).toContain('status');
  });

  it('refuses a new time the same way', async () => {
    const { service } = workshops('cancelled');
    await refusedAsCancelled(
      service.updateSession(SATURDAY, { startTime: '2026-11-14T10:00:00Z' }, LEAD),
    );
  });

  it('tells its people nothing when it is cancelled again', async () => {
    const { notices, service } = workshops('cancelled');
    await service.updateSession(SATURDAY, { status: 'cancelled' }, LEAD);
    expect(notices.workshopCancelled).not.toHaveBeenCalled();
  });

  it('still lets its status change through the API', async () => {
    const { db, service } = workshops('cancelled');
    await service.updateSession(SATURDAY, { status: 'scheduled' }, LEAD);
    expect(writesTo(db, 'workshop_sessions').map((w) => w.row)).toEqual([{ status: 'scheduled' }]);
  });

  it('moves a session that runs, as before', async () => {
    const { db, service } = workshops('scheduled');
    await service.updateSession(SATURDAY, { venueId: 'venue-a2' }, LEAD);
    expect(writesTo(db, 'workshop_sessions').map((w) => w.row)).toEqual([{ venue_id: 'venue-a2' }]);
  });
});

describe('deleting a cancelled session', () => {
  it('tells its people nothing a second time (527)', async () => {
    const { db, notices, service } = workshops('cancelled');
    await service.deleteSession(SATURDAY, LEAD);
    expect(notices.workshopCancelled).not.toHaveBeenCalled();
    expect(writesTo(db, 'workshop_sessions').map((w) => w.op)).toEqual(['delete']);
  });

  it('tells them once when it was running', async () => {
    const { notices, service } = workshops('scheduled');
    await service.deleteSession(SATURDAY, LEAD);
    expect(notices.workshopCancelled).toHaveBeenCalledTimes(1);
  });
});

describe('nobody is promoted into a cancelled session', () => {
  it('leaves Bob on the waitlist when Alice gives up her seat', async () => {
    const { db, promoted, service } = enrollments('cancelled');
    await service.cancel(SATURDAY, 'alice');
    expect(writesTo(db, 'workshop_enrollments').filter((w) => w.op === 'update')).toEqual([]);
    expect(promoted).not.toHaveBeenCalled();
  });

  it('promotes Bob when Alice gives up a seat in a session that runs', async () => {
    const { promoted, service } = enrollments('scheduled');
    await service.cancel(SATURDAY, 'alice');
    expect(promoted).toHaveBeenCalledWith(SATURDAY, 'bob');
  });

  it("refuses an instructor's accept from a roster opened before the cancel", async () => {
    const { db, promoted, service } = enrollments('cancelled');
    await refusedAsCancelled(service.accept(SATURDAY, 'bob'));
    expect(writesTo(db, 'workshop_enrollments')).toEqual([]);
    expect(promoted).not.toHaveBeenCalled();
  });

  it("refuses the organiser's promotion, writing nothing", async () => {
    const { db, promoted, service } = enrollments('cancelled');
    await refusedAsCancelled(service.promote(SATURDAY, 'bob'));
    expect(writesTo(db, 'workshop_enrollments')).toEqual([]);
    expect(promoted).not.toHaveBeenCalled();
  });
});
