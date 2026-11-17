/**
 * Who may read a Match's protests: the readers of its cards (`GET matches/:id/penalties`).
 *
 * A bout of a draft Event, or of a Tournament that is not published, running or completed, is
 * hidden from everyone but a member of the Event's club and an active staff session of the same
 * Event (rulings 81-83, 89). A hidden bout answers as an unknown one: no protests. The visibility
 * check runs for real over seeded tables; the list itself is stubbed.
 */
import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { ProtestsController } from './protests.controller';

const EVENT_OPEN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EVENT_DRAFT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const OPEN = '11111111-1111-4111-8111-111111111111';
const IN_DRAFT_EVENT = '22222222-2222-4222-8222-222222222222';
const IN_DRAFT_TOURNAMENT = '33333333-3333-4333-8333-333333333333';
const MEMBER = 'a0000000-0000-4000-8000-000000000001';
const STRANGER = 'a0000000-0000-4000-8000-000000000002';

function bout(id: string, tournamentStatus: string, eventId: string, eventStatus: string) {
  return {
    id,
    phases: {
      tournaments: {
        status: tournamentStatus,
        events: { id: eventId, status: eventStatus, organization_id: 'org-a', event_kind: null },
      },
    },
  };
}

type Caller = { user?: string };

function req(caller: Caller = {}) {
  const identity = caller.user
    ? { kind: 'claimed', userId: caller.user, email: null }
    : { kind: 'anonymous' };
  return { headers: {}, cookies: {}, identity, staffSession: null } as never;
}

let db: ReturnType<typeof mockSupabase>;
let list: ReturnType<typeof vi.fn>;
let controller: ProtestsController;

beforeEach(() => {
  db = mockSupabase({
    matches: {
      rows: [
        bout(OPEN, 'running', EVENT_OPEN, 'published'),
        bout(IN_DRAFT_EVENT, 'running', EVENT_DRAFT, 'draft'),
        bout(IN_DRAFT_TOURNAMENT, 'draft', EVENT_OPEN, 'published'),
      ],
    },
    organization_members: {
      rows: [{ organization_id: 'org-a', user_id: MEMBER, role: 'read_only' }],
    },
  });
  list = vi.fn(async (id: string) => [{ id: `protest-of-${id}` }]);
  controller = new ProtestsController(
    { listMatchProtests: list } as never,
    { service: db.service } as never,
    {} as never,
    new OrganizationsService({ service: db.service } as never),
  );
});

describe('GET matches/:id/protests', () => {
  it("lists a public bout's protests to anyone, signed out included", async () => {
    await expect(controller.listMatchProtests(OPEN, req())).resolves.toEqual([
      { id: `protest-of-${OPEN}` },
    ]);
  });

  it('returns [] when canReadMatch is false, and never reads the protests', async () => {
    for (const id of [IN_DRAFT_EVENT, IN_DRAFT_TOURNAMENT]) {
      await expect(controller.listMatchProtests(id, req())).resolves.toEqual([]);
      await expect(controller.listMatchProtests(id, req({ user: STRANGER }))).resolves.toEqual([]);
    }
    expect(list).not.toHaveBeenCalled();
  });

  it("lists a hidden bout's protests to a member of its club", async () => {
    await expect(
      controller.listMatchProtests(IN_DRAFT_EVENT, req({ user: MEMBER })),
    ).resolves.toEqual([{ id: `protest-of-${IN_DRAFT_EVENT}` }]);
    expect(selectsFor(db.from, 'matches')).toContain(
      'phases!inner(tournaments!inner(status, events!inner(id, status, organization_id, event_kind)))',
    );
  });
});
