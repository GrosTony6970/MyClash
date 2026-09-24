/**
 * Who may check an archive before restoring it, `POST /archive/restore-preview`
 * (operator ruling 87): a signed-in admin or owner of at least one organization, or
 * platform staff. It parses only the upload, but it parsed it for anyone,
 * signed out included. A member below admin is refused, as is a competitor
 * account with no organization. Every refusal comes before the upload is read.
 *
 * Driven through the controller with the real OrganizationsService and the
 * real platform-role lookup over seeded tables.
 */
import 'reflect-metadata';
import { ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
let previewRestore: ReturnType<typeof vi.fn>;
let controller: ExportsController;

function build(overrides: Record<string, TableSeed> = {}) {
  db = mockSupabase({ ...TABLES, ...overrides });
  // The access token IS the user id here: GoTrue is the only thing doubled by hand.
  const getUser = vi.fn(async (token: string) => ({ data: { user: { id: token } } }));
  const supabase = { service: db.service, anon: { auth: { getUser } } };
  previewRestore = vi.fn().mockResolvedValue({ canRestore: true });
  controller = new ExportsController(
    {} as never,
    supabase as never,
    { previewRestore } as never,
    new OrganizationsService(supabase as never),
  );
}

beforeEach(() => build());

/** A multipart request carrying one archive; `file` records whether the upload was read. */
function upload(token?: string) {
  const file = vi.fn().mockResolvedValue({
    filename: 'event.json',
    toBuffer: () => Promise.resolve(Buffer.from('{}')),
  });
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  return { req: { headers, cookies: {}, file } as never, file };
}

describe('POST /archive/restore-preview (ruling 87)', () => {
  it.each([
    ['an admin of an organization', ADMIN],
    ['platform staff, with no organization', PLATFORM],
  ])('lets %s check an archive', async (_label, user) => {
    const { req } = upload(user);
    expect(await controller.restorePreview(req)).toEqual({ canRestore: true });
    expect(previewRestore).toHaveBeenCalledWith(expect.any(Buffer), user);
  });

  it('answers a signed-out caller 401 before reading the upload', async () => {
    const { req, file } = upload();
    await expect(controller.restorePreview(req)).rejects.toThrow(UnauthorizedException);
    expect(file).not.toHaveBeenCalled();
  });

  it.each([
    ['an organization member below admin', EDITOR],
    ['a competitor account with no organization', COMPETITOR],
  ])('refuses %s before reading the upload', async (_label, user) => {
    const { req, file } = upload(user);
    await expect(controller.restorePreview(req)).rejects.toThrow(ForbiddenException);
    expect(file).not.toHaveBeenCalled();
    expect(previewRestore).not.toHaveBeenCalled();
  });

  it("asks only for the caller's own memberships", async () => {
    await controller.restorePreview(upload(ADMIN).req);
    expect(selectsFor(db.from, 'organization_members')).toEqual(['role']);
  });

  it('fails a failed membership read loudly, never as "not an admin"', async () => {
    build({ organization_members: { data: null, error: { message: 'boom' } } });
    const call = controller.restorePreview(upload(ADMIN).req);
    await expect(call).rejects.toThrow('membership read failed: boom');
    await expect(call).rejects.not.toBeInstanceOf(HttpException);
  });
});
