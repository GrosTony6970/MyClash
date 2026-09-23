/**
 * Who may link a workshop enrolment to a global profile.
 *
 * Until 2026-09-23 `PATCH global-persons/:id/link-workshop-enrollment` asked
 * nobody: with the guard in shadow mode (the production default) anyone could
 * attach any enrolment to any profile, and the roster then shows that profile's
 * name. Its one caller is the roster on the organiser's workshops page. The bar
 * is `workshop_lead` on the enrolment's own Event (operator ruling 38) — the bar
 * the Workshops module already manages a workshop at, and the one its sibling
 * roster writes use (enrol a person, promote off the waitlist, accept, refuse).
 *
 * The Event is read from the enrolment — enrolment → session → workshop → Event
 * — never taken from the caller, so naming somebody else's enrolment cannot move
 * the decision onto an Event you do hold.
 *
 * Driven through the controller and the real org-role check over seeded tables.
 * The fighters service is a stub, so "refused" means "never reached".
 */
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mockSupabase, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { GlobalPersonsController } from './fighters.controller';

const EVENT_A = '11111111-1111-4111-8111-111111111111';
const EVENT_B = '22222222-2222-4222-8222-222222222222';
const ENROLMENT_A = '33333333-3333-4333-8333-333333333333';
const ENROLMENT_B = '44444444-4444-4444-8444-444444444444';
const NO_ENROLMENT = '99999999-9999-4999-8999-999999999999';
const PROFILE = '55555555-5555-4555-8555-555555555555';

let db: ReturnType<typeof mockSupabase>;
let link: Mock;
let controller: GlobalPersonsController;

beforeEach(() => {
  db = mockSupabase({
    events: {
      rows: [
        { id: EVENT_B, organization_id: 'org-b' },
        { id: EVENT_A, organization_id: 'org-a' },
      ],
    },
    workshops: {
      rows: [
        { id: 'w-b', event_id: EVENT_B },
        { id: 'w-a', event_id: EVENT_A },
      ],
    },
    workshop_sessions: {
      rows: [
        { id: 's-b', workshop_id: 'w-b' },
        { id: 's-a', workshop_id: 'w-a' },
      ],
    },
    workshop_enrollments: {
      rows: [
        { id: ENROLMENT_B, workshop_session_id: 's-b' },
        { id: ENROLMENT_A, workshop_session_id: 's-a' },
      ],
    },
    organization_members: {
      rows: [
        { organization_id: 'org-b', user_id: 'u-lead-b', role: 'workshop_lead' },
        { organization_id: 'org-a', user_id: 'u-lead-a', role: 'workshop_lead' },
        // The role just below the bar.
        { organization_id: 'org-a', user_id: 'u-referee-a', role: 'referee' },
        // Owner elsewhere, read-only here: a decision taken on the wrong
        // organisation would let this account link Event A's enrolments.
        { organization_id: 'org-b', user_id: 'u-reader-a', role: 'owner' },
        { organization_id: 'org-a', user_id: 'u-reader-a', role: 'read_only' },
      ],
    },
  });
  link = vi.fn(async () => undefined);
  // The token IS the user id here; no token at all is the anonymous caller.
  const supabase = {
    service: db.service,
    getAuthUser: vi.fn(async (token: string) => ({ id: token })),
  };
  controller = new GlobalPersonsController(
    { linkWorkshopEnrollment: link } as never,
    supabase as never,
    new OrganizationsService(db as never),
  );
});

/** A request from `userId`; none = no token. */
function req(userId?: string) {
  return { headers: userId ? { authorization: `Bearer ${userId}` } : {}, cookies: {} } as never;
}

const linkAs = (userId: string | undefined, enrollmentId = ENROLMENT_A) =>
  controller.linkWorkshopEnrollment(PROFILE, { enrollmentId }, req(userId));

describe('GlobalPersonsController.linkWorkshopEnrollment authorization', () => {
  it('refuses a caller with no token, before any read', async () => {
    await expect(linkAs(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(queriedTables(db.from)).toEqual([]);
    expect(link).not.toHaveBeenCalled();
  });

  it("refuses a workshop lead of another organisation, on the enrolment's own Event", async () => {
    await expect(linkAs('u-lead-b')).rejects.toBeInstanceOf(ForbiddenException);
    expect(link).not.toHaveBeenCalled();
  });

  it('refuses a member below workshop lead', async () => {
    await expect(linkAs('u-referee-a')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(linkAs('u-reader-a')).rejects.toBeInstanceOf(ForbiddenException);
    expect(link).not.toHaveBeenCalled();
  });

  it('answers 404 for an enrolment that does not exist', async () => {
    await expect(linkAs('u-lead-a', NO_ENROLMENT)).rejects.toBeInstanceOf(NotFoundException);
    expect(link).not.toHaveBeenCalled();
  });

  it("lets a workshop lead of the enrolment's Event link it", async () => {
    await expect(linkAs('u-lead-a')).resolves.toEqual({ linked: true });
    await expect(linkAs('u-lead-b', ENROLMENT_B)).resolves.toEqual({ linked: true });
    expect(link.mock.calls).toEqual([
      [ENROLMENT_A, PROFILE],
      [ENROLMENT_B, PROFILE],
    ]);
  });

  it('reads each hop from the row that names it', async () => {
    await linkAs('u-lead-a');
    expect(selectsFor(db.from, 'workshop_enrollments')).toEqual(['workshop_session_id']);
    expect(selectsFor(db.from, 'workshop_sessions')).toEqual(['workshop_id']);
    expect(selectsFor(db.from, 'workshops')).toEqual(['event_id']);
    expect(selectsFor(db.from, 'events')).toEqual(['organization_id']);
  });
});
