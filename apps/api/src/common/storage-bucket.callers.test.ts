import { describe, expect, it, vi } from 'vitest';
import { ClubsService } from '../modules/clubs/clubs.service';
import { FightersService } from '../modules/fighters/fighters.service';
import { LeaguesService } from '../modules/leagues/leagues.service';
import { OrganizationsService } from '../modules/organizations/organizations.service';

/**
 * Each image upload creates its bucket through `ensurePublicBucket` with the
 * bucket name, size cap and image types it means. The upload tests mock the
 * bucket as present, so without this a skipped call or a wrong name, cap or
 * type list would stay green. (Clubs, leagues and organisations share
 * event-assets and the same values, so trading one of those constants for
 * another is not something this can see, nor something that would matter.)
 * The bucket is missing and its creation refused, so each upload stops right
 * after the call this file is about.
 */

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MB = 1024 * 1024;
const png = { buffer: Buffer.from('png'), filename: 'logo.png', mimetype: 'image/png' };

function missingBucketStorage() {
  return {
    getBucket: vi.fn(async () => ({ data: null, error: { message: 'Bucket not found' } })),
    createBucket: vi.fn(async () => ({ data: null, error: { message: 'create refused' } })),
  };
}

function expectCreated(
  storage: ReturnType<typeof missingBucketStorage>,
  bucket: string,
  maxBytes: number,
) {
  expect(storage.getBucket).toHaveBeenCalledWith(bucket);
  expect(storage.createBucket).toHaveBeenCalledOnce();
  const [name, options] = storage.createBucket.mock.calls[0] as unknown as [
    string,
    { public: boolean; fileSizeLimit: number; allowedMimeTypes: string[] },
  ];
  expect(name).toBe(bucket);
  expect(options.public).toBe(true);
  expect(options.fileSizeLimit).toBe(maxBytes);
  expect([...options.allowedMimeTypes].sort()).toEqual(IMAGE_TYPES);
}

/** The access check before the upload, answered: it is not what this file tests. */
function allow(service: object, method: string, value: unknown) {
  (service as Record<string, unknown>)[method] = vi.fn(async () => value);
}

function supabaseWith(storage: ReturnType<typeof missingBucketStorage>) {
  return { service: { storage }, anon: {} } as never;
}

describe('each image upload creates its own bucket', () => {
  it('a club logo: event-assets, 10 MB', async () => {
    const storage = missingBucketStorage();
    const service = new ClubsService(supabaseWith(storage));
    allow(service, 'getClubById', { id: 'club-1' });
    await expect(service.uploadLogo('club-1', png)).rejects.toThrow('create refused');
    expectCreated(storage, 'event-assets', 10 * MB);
  });

  it('a fighter photo: fighter-photos, 15 MB', async () => {
    const storage = missingBucketStorage();
    const service = new FightersService(supabaseWith(storage), {} as never);
    allow(service, 'resolveMyGlobalPersonId', 'gp-1');
    await expect(service.uploadMyPhoto('user-1', png)).rejects.toThrow('create refused');
    expectCreated(storage, 'fighter-photos', 15 * MB);
  });

  it('a league logo: event-assets, 10 MB', async () => {
    const storage = missingBucketStorage();
    const service = new LeaguesService(supabaseWith(storage), {} as never, {} as never);
    allow(service, 'assertCanManageLeague', undefined);
    await expect(service.uploadLogo('league-1', png, 'user-1')).rejects.toThrow('create refused');
    expectCreated(storage, 'event-assets', 10 * MB);
  });

  it('an organisation logo: event-assets, 10 MB', async () => {
    const storage = missingBucketStorage();
    const service = new OrganizationsService(supabaseWith(storage));
    allow(service, 'assertOrgRole', undefined);
    await expect(service.uploadLogo('org-1', 'user-1', png)).rejects.toThrow('create refused');
    expectCreated(storage, 'event-assets', 10 * MB);
  });
});
