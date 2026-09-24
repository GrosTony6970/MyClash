/**
 * Who may search clubs, `GET /clubs` (operator ruling 98): anyone, signed in or
 * not — a club row names a club, its city and its logo, and nothing about a
 * person. Archived clubs come back only when platform staff ask for them; to
 * everyone else `includeArchived` changes nothing.
 *
 * The abbreviation search builds a PostgREST `.or()` string from `q`, so a `,`
 * in `q` used to add sibling filters of the caller's choosing.
 *
 * Driven through the controller with the real ClubsService and the real
 * platform-role lookup over seeded tables.
 */
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { IS_PUBLIC_KEY } from '../../common/auth/public.decorator';
import {
  mockSupabase,
  queriedTables,
  selectsFor,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { ClubsController } from './clubs.controller';
import { ClubsService } from './clubs.service';

const COMPETITOR = '22222222-2222-4222-8222-222222222222';
const PLATFORM = '33333333-3333-4333-8333-333333333333';

const CLUBS = [
  { id: 'c-1', name: 'Salle Lyon', abbreviation: 'SL', archived_at: null },
  { id: 'c-2', name: 'Salle Nantes', abbreviation: 'SN', archived_at: '2026-01-01T00:00:00Z' },
  { id: 'c-3', name: 'Zweihander Club', abbreviation: 'ZC', archived_at: null },
];
const LIVE = ['Salle Lyon', 'Zweihander Club'];

const TABLES: Record<string, TableSeed> = {
  clubs: { rows: CLUBS },
  platform_roles: { rows: [{ user_id: PLATFORM, role: 'platform_viewer' }] },
};

let db: ReturnType<typeof mockSupabase>;
let controller: ClubsController;

function build(overrides: Record<string, TableSeed> = {}) {
  db = mockSupabase({ ...TABLES, ...overrides });
  controller = new ClubsController(new ClubsService({ service: db.service } as never));
}

beforeEach(() => build());

const claimed = (userId: string) => ({ identity: { kind: 'claimed', userId, email: null } });
const ANONYMOUS = { identity: { kind: 'anonymous' } };
const ARCHIVED = { includeArchived: 'true' };

async function names(query: Record<string, unknown>, req: unknown): Promise<string[]> {
  const rows = (await controller.list(query as never, req as never)) as { name: string }[];
  return rows.map((row) => row.name);
}

describe('GET /clubs (ruling 98)', () => {
  it('is public: a signed-out visitor may search clubs', async () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, ClubsController.prototype.list)).toBe(true);
    expect(await names({}, ANONYMOUS)).toEqual(LIVE);
  });

  it('lists archived clubs for platform staff who ask for them', async () => {
    expect(await names(ARCHIVED, claimed(PLATFORM))).toEqual([
      'Salle Lyon',
      'Salle Nantes',
      'Zweihander Club',
    ]);
  });

  it('gives a signed-in account with no platform role live clubs only, archived asked or not', async () => {
    expect(await names(ARCHIVED, claimed(COMPETITOR))).toEqual(LIVE);
  });

  it.each([
    ['a signed-out visitor', ANONYMOUS],
    ['an Event staff login', { identity: { kind: 'staff', staffId: 's-1', eventId: 'e-1' } }],
    [
      'a guest token',
      { identity: { kind: 'guest', guestSessionId: 'g-1', personId: 'p-1', eventId: 'e-1' } },
    ],
  ])('gives %s live clubs only, and looks up no platform role', async (_label, req) => {
    expect(await names(ARCHIVED, req)).toEqual(LIVE);
    expect(queriedTables(db.from)).toEqual(['clubs']);
  });

  it('looks up no platform role when archived clubs are not asked for', async () => {
    expect(await names({}, claimed(PLATFORM))).toEqual(LIVE);
    expect(queriedTables(db.from)).toEqual(['clubs']);
  });

  it("asks for the caller's platform role only", async () => {
    await names(ARCHIVED, claimed(PLATFORM));
    expect(selectsFor(db.from, 'platform_roles')).toEqual(['role']);
    expect(selectsFor(db.from, 'clubs')).toEqual(['*']);
  });

  it('still finds a club by its abbreviation', async () => {
    expect(await names({ q: 'ZC', searchAbv: 'true' }, ANONYMOUS)).toEqual(['Zweihander Club']);
  });

  it('adds no filter of the caller\'s own through a "," in the abbreviation search', async () => {
    const injected = { q: 'zz,archived_at.is.null,name.eq.zz', searchAbv: 'true' };
    expect(await names(injected, ANONYMOUS)).toEqual([]);
  });

  it('fails a failed read loudly (5xx), never as a 400 carrying the database text', async () => {
    build({ clubs: { data: null, error: { message: 'boom' } } });
    const call = names({}, ANONYMOUS);
    await expect(call).rejects.toThrow('clubs read failed: boom');
    await expect(call).rejects.not.toBeInstanceOf(HttpException);
  });
});
