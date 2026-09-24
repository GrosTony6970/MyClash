/**
 * Who may read venues.
 *
 * Until 2026-09-23 all four reads resolved no caller at all.
 *
 * - A club's venue catalogue and one venue (address, areas, pistes, and the
 *   names of the Events using each venue, drafts included): any member of the
 *   venue's own organisation, any role (operator ruling 77). A signed-out
 *   caller gets 401 before anything is read.
 * - The venues an Event uses and a Tournament's venue per phase are public
 *   reads: `venues.public-reads.test.ts` (rulings 81-83, 96).
 *
 * Driven through the controller and the real service over seeded tables.
 */
import 'reflect-metadata';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { VenuesController } from './venues.controller';
import { VenuesService } from './venues.service';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const VENUE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VENUE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DRAFT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PUBLISHED = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const NOBODY = '99999999-9999-4999-8999-999999999999';

let db: ReturnType<typeof mockSupabase>;
let controller: VenuesController;

function venue(id: string, orgId: string, name: string) {
  return {
    id,
    organization_id: orgId,
    name,
    address: `${name} street`,
    venue_areas: [],
    venue_lices: [],
  };
}

beforeEach(() => {
  db = mockSupabase({
    venues: { rows: [venue(VENUE_B, ORG_B, 'Hall B'), venue(VENUE_A, ORG_A, 'Hall A')] },
    events: {
      rows: [
        { id: PUBLISHED, organization_id: ORG_A, status: 'published', name: 'Open', slug: 'open' },
        { id: DRAFT, organization_id: ORG_A, status: 'draft', name: 'Secret', slug: 'secret' },
      ],
    },
    event_venues: {
      rows: [
        { event_id: DRAFT, venue_id: VENUE_A },
        { event_id: PUBLISHED, venue_id: VENUE_A },
      ],
    },
    lices: { rows: [] },
    workshop_sessions: { rows: [] },
    organization_members: {
      rows: [
        { organization_id: ORG_B, user_id: 'u-owner-b', role: 'owner' },
        { organization_id: ORG_A, user_id: 'u-member-a', role: 'read_only' },
      ],
    },
    platform_roles: { rows: [{ user_id: 'u-padmin', role: 'platform_admin' }] },
  });
  // The token IS the user id here; no token at all is the anonymous caller.
  const supabase = {
    service: db.service,
    getAuthUser: vi.fn(async (token: string) => ({ id: token })),
    anon: {
      auth: {
        getUser: vi.fn(async (token: string) => ({ data: { user: { id: token } }, error: null })),
      },
    },
  };
  const service = new VenuesService(supabase as never, new OrganizationsService(supabase as never));
  controller = new VenuesController(service, supabase as never);
});

/** A request from `userId`; none = no token. */
function req(userId?: string) {
  return {
    headers: userId ? { authorization: `Bearer ${userId}` } : {},
    cookies: {},
  } as never;
}

async function oneAnswer(
  call: (caller?: string) => Promise<unknown>,
  callers: string[],
  type: unknown,
) {
  const answers: unknown[] = [];
  for (const caller of callers) {
    const refusal = await call(caller).catch((error: unknown) => error);
    expect(refusal, caller).toBeInstanceOf(type as never);
    answers.push((refusal as ForbiddenException).getResponse());
  }
  return new Set(answers.map((answer) => JSON.stringify(answer))).size;
}

const idsOf = (rows: unknown) => (rows as { id: string }[]).map((row) => row.id);

describe("a club's venue catalogue (ruling 77)", () => {
  it('refuses a caller with no token, before any read', async () => {
    await expect(controller.listForOrg(ORG_A, req())).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.get(VENUE_A, req())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(queriedTables(db.from)).toEqual([]);
  });

  it("refuses an outsider, another club's owner and platform staff the list, with one answer, before reading it", async () => {
    const size = await oneAnswer(
      (caller) => controller.listForOrg(ORG_A, req(caller)),
      ['u-stranger', 'u-owner-b', 'u-padmin'],
      ForbiddenException,
    );
    expect(size).toBe(1);
    expect(queriedTables(db.from)).not.toContain('venues');
  });

  it('lets a read-only member list the club’s venues', async () => {
    await expect(controller.listForOrg(ORG_A, req('u-member-a')).then(idsOf)).resolves.toEqual([
      VENUE_A,
    ]);
  });

  it('checks one venue against its OWN club, not one the caller belongs to', async () => {
    await expect(controller.get(VENUE_A, req('u-member-a'))).resolves.toMatchObject({
      id: VENUE_A,
    });
    await expect(controller.get(VENUE_B, req('u-member-a'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(controller.get(VENUE_A, req('u-owner-b'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('answers 404 for a venue that does not exist', async () => {
    await expect(controller.get(NOBODY, req('u-member-a'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reads the deciding column', async () => {
    await controller.listForOrg(ORG_A, req('u-member-a'));
    // The double hands back the whole row whatever is selected.
    expect(selectsFor(db.from, 'organization_members')).toEqual(['role']);
  });
});
