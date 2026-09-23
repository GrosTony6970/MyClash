/**
 * Who may read an organisation's own record.
 *
 * Until 2026-09-23 both reads resolved no caller at all. `GET organizations/:id`
 * handed anyone every member's account id and role; `GET organizations/slug/:slug`
 * handed anyone the contact email and the approval state of any club by its
 * short name.
 *
 * - by id: a member of that organisation, any role (operator ruling 70). No
 *   page calls it; it stays for members.
 * - by slug: a member of that organisation, any role, or platform staff of any
 *   tier (ruling 71) — the web-admin shell lets platform staff into every
 *   club's pages, and every one of those pages resolves the club by slug first.
 *
 * A signed-out caller gets 401 before anything is read. Driven through the
 * controller and the real service over seeded tables.
 */
import 'reflect-metadata';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const NOBODY = '99999999-9999-4999-8999-999999999999';

let db: ReturnType<typeof mockSupabase>;
let controller: OrganizationsController;

beforeEach(() => {
  db = mockSupabase({
    organizations: {
      rows: [
        {
          id: ORG_B,
          name: 'Club B',
          slug: 'club-b',
          status: 'pending_approval',
          logo_url: null,
          brand_color: null,
          contact_email: 'contact@club-b.test',
          organization_members: [{ user_id: 'u-owner-b', role: 'owner' }],
        },
        {
          id: ORG_A,
          name: 'Club A',
          slug: 'club-a',
          status: 'active',
          logo_url: null,
          brand_color: null,
          contact_email: 'contact@club-a.test',
          organization_members: [{ user_id: 'u-member-a', role: 'read_only' }],
        },
      ],
    },
    organization_members: {
      rows: [
        { organization_id: ORG_B, user_id: 'u-owner-b', role: 'owner' },
        { organization_id: ORG_A, user_id: 'u-member-a', role: 'read_only' },
        { organization_id: ORG_A, user_id: 'u-owner-a', role: 'owner' },
      ],
    },
    platform_roles: {
      rows: [
        { user_id: 'u-viewer', role: 'platform_viewer' },
        { user_id: 'u-padmin', role: 'platform_admin' },
        { user_id: 'u-super', role: 'super_admin' },
      ],
    },
  });
  // The token IS the user id here; no token at all is the anonymous caller.
  const supabase = {
    service: db.service,
    getAuthUser: vi.fn(async (token: string) => ({ id: token })),
  };
  const service = new OrganizationsService(supabase as never);
  controller = new OrganizationsController(service, supabase as never);
});

/** A request from `userId`; none = no token. */
function req(userId?: string) {
  return {
    headers: userId ? { authorization: `Bearer ${userId}` } : {},
    cookies: {},
  } as never;
}

async function refusals(call: (caller: string) => Promise<unknown>, callers: string[]) {
  const answers: unknown[] = [];
  for (const caller of callers) {
    const refusal = await call(caller).catch((error: unknown) => error);
    expect(refusal, caller).toBeInstanceOf(ForbiddenException);
    answers.push((refusal as ForbiddenException).getResponse());
  }
  return new Set(answers.map((answer) => JSON.stringify(answer)));
}

describe('OrganizationsController.getById', () => {
  it('refuses a caller with no token, before any read', async () => {
    await expect(controller.getById(ORG_A, req())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(queriedTables(db.from)).toEqual([]);
  });

  // A super admin who is not a member is refused too: `assertOrgRole` grants no
  // platform bypass, and ruling 70 names members only.
  it("refuses an outsider, another club's owner and platform staff, with one answer, before reading the club", async () => {
    const answers = await refusals(
      (caller) => controller.getById(ORG_A, req(caller)),
      ['u-stranger', 'u-owner-b', 'u-viewer', 'u-padmin', 'u-super'],
    );
    expect(answers.size).toBe(1);
    expect(queriedTables(db.from)).not.toContain('organizations');
  });

  it("answers an unknown id as it answers another club's", async () => {
    const unknown = await controller.getById(NOBODY, req('u-member-a')).catch((e: unknown) => e);
    const foreign = await controller.getById(ORG_B, req('u-member-a')).catch((e: unknown) => e);
    expect(unknown).toBeInstanceOf(ForbiddenException);
    expect((unknown as ForbiddenException).getResponse()).toEqual(
      (foreign as ForbiddenException).getResponse(),
    );
  });

  it('lets a read-only member read their own club, members included', async () => {
    await expect(controller.getById(ORG_A, req('u-member-a'))).resolves.toMatchObject({
      id: ORG_A,
      organization_members: [{ user_id: 'u-member-a', role: 'read_only' }],
    });
  });

  it('reads the deciding column', async () => {
    await controller.getById(ORG_A, req('u-member-a'));
    // The double hands back the whole row whatever is selected.
    expect(selectsFor(db.from, 'organization_members')).toEqual(['role']);
  });
});

describe('OrganizationsController.getBySlug', () => {
  it('refuses a caller with no token, before any read', async () => {
    await expect(controller.getBySlug('club-a', req())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(queriedTables(db.from)).toEqual([]);
  });

  it("refuses an outsider and another club's owner, with one answer", async () => {
    const answers = await refusals(
      (caller) => controller.getBySlug('club-a', req(caller)),
      ['u-stranger', 'u-owner-b'],
    );
    expect(answers.size).toBe(1);
  });

  it("checks the club the slug names against the caller's own", async () => {
    await expect(controller.getBySlug('club-b', req('u-member-a'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(controller.getBySlug('club-b', req('u-owner-b'))).resolves.toMatchObject({
      id: ORG_B,
    });
  });

  it('lets a read-only member read their club, contact email included', async () => {
    await expect(controller.getBySlug('club-a', req('u-member-a'))).resolves.toMatchObject({
      id: ORG_A,
      contact_email: 'contact@club-a.test',
    });
  });

  it('lets platform staff of any tier read any club', async () => {
    for (const caller of ['u-viewer', 'u-padmin']) {
      await expect(controller.getBySlug('club-b', req(caller)), caller).resolves.toMatchObject({
        id: ORG_B,
      });
    }
  });

  it('answers 404 for a slug no club has', async () => {
    await expect(controller.getBySlug('no-such-club', req('u-member-a'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reads each deciding column', async () => {
    await controller.getBySlug('club-a', req('u-member-a'));
    expect(selectsFor(db.from, 'organizations')).toEqual([
      'id, name, slug, status, logo_url, brand_color, contact_email',
    ]);
    expect(selectsFor(db.from, 'platform_roles')).toEqual(['role']);
    expect(selectsFor(db.from, 'organization_members')).toEqual(['role']);
  });
});
