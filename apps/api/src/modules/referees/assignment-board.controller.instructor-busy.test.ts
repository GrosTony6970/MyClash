/**
 * The Workshop board's busy read (rulings 553-555) has the crew-conflicts bar: any member of
 * the Event. A caller who is not one is refused before anything is loaded.
 */
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { AssignmentBoardController } from './assignment-board.controller';

const BUSY = {
  busy: [
    {
      personId: 'person-paul',
      kind: 'referee',
      label: 'Longsword · Pool 3',
      startsAt: '2026-05-21T10:00:00.000Z',
      endsAt: '2026-05-21T11:30:00.000Z',
    },
  ],
};

function makeController(member: boolean) {
  const supabase = mockSupabase({
    events: { rows: [{ id: 'event-1', organization_id: 'org-1' }] },
  });
  const orgs = {
    assertOrgRole: vi.fn(() =>
      member ? Promise.resolve() : Promise.reject(new ForbiddenException('not a member')),
    ),
  };
  const getInstructorBusy = vi.fn().mockResolvedValue(BUSY);
  const controller = new AssignmentBoardController(
    { getInstructorBusy } as never,
    supabase as never,
    orgs as never,
  );
  return { controller, orgs, getInstructorBusy };
}

const REQ = { headers: {} } as never;

describe('GET events/:eventId/workshop-instructor-busy', () => {
  it("answers a member of the Event's organisation with the service's answer", async () => {
    const { controller, orgs, getInstructorBusy } = makeController(true);

    await expect(controller.getInstructorBusy('event-1', REQ)).resolves.toEqual(BUSY);
    expect(orgs.assertOrgRole).toHaveBeenCalledWith('org-1', expect.any(String), 'read_only');
    expect(getInstructorBusy).toHaveBeenCalledWith('event-1');
  });

  it('refuses a caller who is not a member, before anything is loaded', async () => {
    const { controller, getInstructorBusy } = makeController(false);

    await expect(controller.getInstructorBusy('event-1', REQ)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(getInstructorBusy).not.toHaveBeenCalled();
  });
});
