/**
 * Who may use the person picker, `GET /global-persons` (operator ruling 86):
 * a member of at least one club, any role, or platform staff. A signed-in
 * competitor account with no club is refused, and so are an Event staff login
 * and a guest token: neither is a club member. Signed out stays a 401.
 *
 * Until 2026-09-24 any signed-in account, and any staff or guest token, could
 * search every global person (name, club, HEMA Ratings id, photo).
 *
 * Driven through the controller with the real OrganizationsService and the
 * real platform-role lookup over seeded tables.
 */
import 'reflect-metadata';
import { ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  queriedTables,
  selectsFor,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { GlobalPersonsController } from './fighters.controller';

const MEMBER = '11111111-1111-4111-8111-111111111111';
const COMPETITOR = '22222222-2222-4222-8222-222222222222';
const PLATFORM = '33333333-3333-4333-8333-333333333333';
const ORG = '44444444-4444-4444-8444-444444444444';

const TABLES: Record<string, TableSeed> = {
  organization_members: { rows: [{ organization_id: ORG, user_id: MEMBER, role: 'read_only' }] },
  platform_roles: { rows: [{ user_id: PLATFORM, role: 'platform_viewer' }] },
};

let db: ReturnType<typeof mockSupabase>;
let listGlobalPersons: ReturnType<typeof vi.fn>;
let controller: GlobalPersonsController;

function build(overrides: Record<string, TableSeed> = {}) {
  db = mockSupabase({ ...TABLES, ...overrides });
  const supabase = { service: db.service };
  listGlobalPersons = vi.fn().mockResolvedValue({ items: [] });
  controller = new GlobalPersonsController(
    { listGlobalPersons } as never,
    supabase as never,
    new OrganizationsService(supabase as never),
  );
}

beforeEach(() => build());

const claimed = (userId: string) => ({ identity: { kind: 'claimed', userId, email: null } });
const list = (req: unknown) => controller.list({} as never, req as never);

describe('GET /global-persons (ruling 86)', () => {
  it('lets a member of any club search, without contact details', async () => {
    await list(claimed(MEMBER));
    expect(listGlobalPersons).toHaveBeenCalledWith({}, { includeContactPii: false });
  });

  it('lets platform staff search, with contact details, whatever their clubs', async () => {
    await list(claimed(PLATFORM));
    expect(listGlobalPersons).toHaveBeenCalledWith({}, { includeContactPii: true });
  });

  it('refuses a competitor account with no club before reading anyone', async () => {
    await expect(list(claimed(COMPETITOR))).rejects.toThrow(ForbiddenException);
    expect(listGlobalPersons).not.toHaveBeenCalled();
  });

  it.each([
    ['an Event staff login', { identity: { kind: 'staff', staffId: 's-1', eventId: ORG } }],
    [
      'a guest token',
      { identity: { kind: 'guest', guestSessionId: 'g-1', personId: 'p-1', eventId: ORG } },
    ],
  ])('refuses %s, which has no user id, before any read', async (_label, req) => {
    await expect(list(req)).rejects.toThrow(ForbiddenException);
    expect(queriedTables(db.from)).toEqual([]);
    expect(listGlobalPersons).not.toHaveBeenCalled();
  });

  it('still answers a signed-out caller 401, and reads nothing', async () => {
    await expect(list({ identity: { kind: 'anonymous' } })).rejects.toThrow(UnauthorizedException);
    expect(queriedTables(db.from)).toEqual([]);
  });

  it("asks only for the caller's own memberships", async () => {
    await list(claimed(MEMBER));
    expect(selectsFor(db.from, 'organization_members')).toEqual(['role']);
  });

  it('fails a failed membership read loudly, never as "not a member"', async () => {
    build({ organization_members: { data: null, error: { message: 'boom' } } });
    const call = list(claimed(MEMBER));
    await expect(call).rejects.toThrow('membership read failed: boom');
    await expect(call).rejects.not.toBeInstanceOf(HttpException);
  });
});
