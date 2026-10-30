/**
 * Who may send an archive to restore (operator ruling 87): a signed-in admin or owner of at least
 * one organization, or platform staff. It holds for both archive routes, the check
 * (`POST /archive/restore-preview`) and the restore (`POST /archive/restore`). The restore read the
 * upload for anyone, signed out included, and only then asked about the target club. A member
 * below admin is refused, as is a competitor account with no organization. Every refusal comes
 * before the upload is read.
 *
 * Driven through the controller with the real OrganizationsService and the
 * real platform-role lookup over seeded tables.
 */
import 'reflect-metadata';
import { ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mockSupabase, selectsFor, type TableSeed } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { ExportsController } from './exports.controller';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const EDITOR = '22222222-2222-4222-8222-222222222222';
const COMPETITOR = '33333333-3333-4333-8333-333333333333';
const PLATFORM = '44444444-4444-4444-8444-444444444444';
const ORG = '55555555-5555-4555-8555-555555555555';

const TABLES: Record<string, TableSeed> = {
  organization_members: {
    rows: [
      { organization_id: ORG, user_id: ADMIN, role: 'admin' },
      { organization_id: ORG, user_id: EDITOR, role: 'editor' },
    ],
  },
  platform_roles: { rows: [{ user_id: PLATFORM, role: 'platform_viewer' }] },
};

let db: ReturnType<typeof mockSupabase>;
let archives: { previewRestore: Mock; restoreArchiveCopy: Mock };
let controller: ExportsController;

function build(overrides: Record<string, TableSeed> = {}) {
  db = mockSupabase({ ...TABLES, ...overrides });
  // The access token IS the user id here: GoTrue is the only thing doubled by hand.
  const getAuthUser = vi.fn(async (token: string) => ({ id: token }));
  const supabase = { service: db.service, getAuthUser };
  archives = {
    previewRestore: vi.fn().mockResolvedValue({ canRestore: true }),
    restoreArchiveCopy: vi.fn().mockResolvedValue({ canRestore: true }),
  };
  controller = new ExportsController(
    {} as never,
    supabase as never,
    archives as never,
    new OrganizationsService(supabase as never),
  );
}

beforeEach(() => build());

/** A multipart request carrying one archive; `file` records whether the upload was read. */
function upload(token?: string) {
  const file = vi.fn().mockResolvedValue({
    filename: 'event.json',
    // The plugin's shape: a file read whole, not cut at the limit.
    file: { resume: () => undefined, truncated: false },
    toBuffer: () => Promise.resolve(Buffer.from('{}')),
  });
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  return { req: { headers, cookies: {}, file } as never, file };
}

/** [route, the handler, the service method it hands the archive to]. */
const DOORS: Array<[string, (req: never) => Promise<unknown>, () => Mock]> = [
  [
    'POST /archive/restore-preview',
    (req) => controller.restorePreview(req),
    () => archives.previewRestore,
  ],
  [
    'POST /archive/restore',
    (req) => controller.restoreArchive(req, {} as never),
    () => archives.restoreArchiveCopy,
  ],
];

describe.each(DOORS)('%s (ruling 87)', (_route, door, service) => {
  it.each([
    ['an admin of an organization', ADMIN],
    ['platform staff, with no organization', PLATFORM],
  ])('lets %s send an archive', async (_label, user) => {
    expect(await door(upload(user).req)).toEqual({ canRestore: true });
    expect(service().mock.calls[0]?.slice(0, 2)).toEqual([expect.any(Buffer), user]);
  });

  it('answers a signed-out caller 401 before reading the upload', async () => {
    const { req, file } = upload();
    await expect(door(req)).rejects.toThrow(UnauthorizedException);
    expect(file).not.toHaveBeenCalled();
  });

  it.each([
    ['an organization member below admin', EDITOR],
    ['a competitor account with no organization', COMPETITOR],
  ])('refuses %s before reading the upload', async (_label, user) => {
    const { req, file } = upload(user);
    await expect(door(req)).rejects.toThrow(ForbiddenException);
    expect(file).not.toHaveBeenCalled();
    expect(service()).not.toHaveBeenCalled();
  });

  it("asks only for the caller's own memberships", async () => {
    await door(upload(ADMIN).req);
    expect(selectsFor(db.from, 'organization_members')).toEqual(['role']);
  });

  it('fails a failed membership read loudly, never as "not an admin"', async () => {
    build({ organization_members: { data: null, error: { message: 'boom' } } });
    const call = door(upload(ADMIN).req);
    await expect(call).rejects.toThrow('membership read failed: boom');
    await expect(call).rejects.not.toBeInstanceOf(HttpException);
  });
});
