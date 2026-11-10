/**
 * A Workshop's photo of one of its instructors (rulings 556, 560, 562): which file a line owns,
 * that a replaced or removed photo's file is deleted and no other, and that an untick takes the
 * line's files before the line.
 *
 * Paul teaches "Longsword basics" (line wi-paul). Lea is the club's Workshop lead.
 */
import 'reflect-metadata';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { WorkshopInstructorDetailsController } from './workshop-instructor-details.controller';
import { WorkshopInstructorDetailsService } from './workshop-instructor-details.service';
import {
  deleteInstructorPhotoFolder,
  instructorPhotoFolder,
  ownPhotoKey,
} from './workshop-instructor-photo';
import { WorkshopsService } from './workshops.service';

const EVENT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const WORKSHOP = 'aaaaaaaa-0000-4000-8000-00000000000a';
const PAUL = 'gp-paul';
const OWN = '/storage/v1/object/public/workshop-assets/workshop_instructors/wi-paul/photo-1.png';

describe('ownPhotoKey: the files a line may delete are its own', () => {
  it("names a file in the line's folder, by a same-origin link or a restore's full one", () => {
    expect(ownPhotoKey(OWN, 'wi-paul')).toBe('workshop_instructors/wi-paul/photo-1.png');
    expect(
      ownPhotoKey(
        'https://app.myclash.fr/storage/v1/object/public/workshop-assets/workshop_instructors/wi-paul/photo-2-1.jpg',
        'wi-paul',
      ),
    ).toBe('workshop_instructors/wi-paul/photo-2-1.jpg');
  });

  it("never another line's file, the Workshop's cover, a profile photo or a link elsewhere", () => {
    for (const link of [
      '/storage/v1/object/public/workshop-assets/workshop_instructors/wi-marie/photo-1.png',
      '/storage/v1/object/public/workshop-assets/workshop_instructors/wi-paul2/photo-1.png',
      '/storage/v1/object/public/workshop-assets/workshops/w-1/logo-1.png',
      '/storage/v1/object/public/fighter-photos/fighters/gp-paul/photo-1.jpg',
      'https://cdn.example.com/paul.png',
      null,
    ]) {
      expect(ownPhotoKey(link, 'wi-paul')).toBeNull();
    }
  });
});

function storageDouble(
  options: { files?: string[]; listError?: string; removeError?: string } = {},
) {
  const removed: string[][] = [];
  const uploaded: string[] = [];
  const bucket = {
    list: vi.fn(async () =>
      options.listError
        ? { data: null, error: { message: options.listError } }
        : { data: (options.files ?? []).map((name) => ({ name })), error: null },
    ),
    remove: vi.fn(async (keys: string[]) => {
      removed.push(keys);
      return options.removeError
        ? { data: null, error: { message: options.removeError } }
        : { data: [], error: null };
    }),
    upload: vi.fn(async (path: string) => {
      uploaded.push(path);
      return { data: { path }, error: null };
    }),
  };
  const storage = {
    from: vi.fn(() => bucket),
    getBucket: vi.fn(async () => ({ data: { name: 'workshop-assets' }, error: null })),
    createBucket: vi.fn(),
  };
  return { storage, removed, uploaded };
}

describe('deleteInstructorPhotoFolder: every file of the line', () => {
  it("lists the line's folder and deletes each file in it", async () => {
    const double = storageDouble({ files: ['photo-1.png', 'photo-2.jpg'] });
    await expect(deleteInstructorPhotoFolder(double.storage as never, 'wi-paul')).resolves.toBe(2);
    expect(double.storage.from).toHaveBeenCalledWith('workshop-assets');
    expect(double.removed).toEqual([
      ['workshop_instructors/wi-paul/photo-1.png', 'workshop_instructors/wi-paul/photo-2.jpg'],
    ]);
  });

  it('a server with no bucket yet is no error', async () => {
    const double = storageDouble({ listError: 'Bucket not found' });
    await expect(deleteInstructorPhotoFolder(double.storage as never, 'wi-paul')).resolves.toBe(0);
  });

  it('any other failure throws', async () => {
    await expect(
      deleteInstructorPhotoFolder(storageDouble({ listError: 'timeout' }).storage as never, 'w'),
    ).rejects.toThrow(/could not be listed/);
    await expect(
      deleteInstructorPhotoFolder(
        storageDouble({ files: ['photo-1.png'], removeError: 'timeout' }).storage as never,
        'w',
      ),
    ).rejects.toThrow(/could not be deleted/);
  });
});

let db: ReturnType<typeof mockSupabase>;
let double: ReturnType<typeof storageDouble>;
let workshops: WorkshopsService;
let controller: WorkshopInstructorDetailsController;

function setUp(photoUrl: string | null, storage = storageDouble()) {
  db = mockSupabase({
    events: { rows: [{ id: EVENT, status: 'published', organization_id: 'org-a' }] },
    workshops: { rows: [{ id: WORKSHOP, event_id: EVENT }] },
    organization_members: {
      rows: [{ organization_id: 'org-a', user_id: 'u-lea', role: 'workshop_lead' }],
    },
    global_persons: {
      rows: [
        { id: PAUL, claimed_by_user_id: 'u-paul' },
        { id: 'gp-marie', claimed_by_user_id: 'u-marie' },
      ],
    },
    workshop_instructors: {
      rows: [{ id: 'wi-paul', workshop_id: WORKSHOP, global_person_id: PAUL, photo_url: photoUrl }],
    },
  });
  double = storage;
  const supabase = {
    service: { ...db.service, storage: double.storage },
    getAuthUser: async (token: string) => ({ id: token }),
  };
  workshops = new WorkshopsService(
    supabase as never,
    {} as never,
    {} as never,
    new OrganizationsService(supabase as never),
    {} as never,
    {} as never,
  );
  controller = new WorkshopInstructorDetailsController(
    new WorkshopInstructorDetailsService(supabase as never, workshops),
    supabase as never,
  );
}

const signedIn = (userId: string) =>
  ({
    headers: { authorization: `Bearer ${userId}` },
    cookies: {},
    identity: { kind: 'claimed', userId, email: null },
  }) as never;
/** A request carrying one small PNG, as the dashboard's cropper sends it. */
const pngUpload = (userId: string) =>
  ({
    headers: { authorization: `Bearer ${userId}` },
    cookies: {},
    identity: { kind: 'claimed', userId, email: null },
    file: vi.fn(async () => ({
      type: 'file',
      fieldname: 'file',
      filename: 'paul.png',
      mimetype: 'image/png',
      file: { resume: vi.fn(), truncated: false },
      toBuffer: async () => Buffer.from('png bytes'),
    })),
  }) as never;
const photoWrites = () =>
  writesTo(db, 'workshop_instructors').map((write) => write.row as Record<string, unknown>);

beforeEach(() => setUp(OWN));

describe('the photo route (562)', () => {
  it("stores it in the line's folder, shows it by a same-origin link, deletes the one it replaces", async () => {
    const answer = await controller.uploadPhoto(WORKSHOP, PAUL, pngUpload('u-paul'));

    expect(double.uploaded).toHaveLength(1);
    expect(double.uploaded[0]).toMatch(/^workshop_instructors\/wi-paul\/photo-\d+\.png$/);
    expect(answer.url).toBe(
      `/storage/v1/object/public/workshop-assets/${String(double.uploaded[0])}`,
    );
    expect(photoWrites()).toEqual([{ photo_url: answer.url }]);
    expect(double.removed).toEqual([['workshop_instructors/wi-paul/photo-1.png']]);
  });

  it('deletes nothing it does not own when the old link was another file', async () => {
    setUp('/storage/v1/object/public/fighter-photos/fighters/gp-paul/photo-1.jpg');
    await controller.uploadPhoto(WORKSHOP, PAUL, pngUpload('u-lea'));
    expect(double.removed).toEqual([]);
  });

  it('removing it clears the link, so the profile shows, and deletes its file', async () => {
    await expect(controller.removePhoto(WORKSHOP, PAUL, signedIn('u-lea'))).resolves.toEqual({
      url: null,
    });
    expect(photoWrites()).toEqual([{ photo_url: null }]);
    expect(double.removed).toEqual([['workshop_instructors/wi-paul/photo-1.png']]);
  });

  it('a co-instructor is refused before the file is read', async () => {
    const req = pngUpload('u-marie');
    await expect(controller.uploadPhoto(WORKSHOP, PAUL, req)).rejects.toThrow(ForbiddenException);
    expect((req as unknown as { file: ReturnType<typeof vi.fn> }).file).not.toHaveBeenCalled();
    expect(double.uploaded).toEqual([]);
  });

  it('the photo of a line that went meanwhile is taken back, and the answer is 404', async () => {
    const service = new WorkshopInstructorDetailsService(
      { service: { ...db.service, storage: double.storage } } as never,
      workshops,
    );
    await expect(
      service.uploadPhoto('wi-gone', {
        buffer: Buffer.from('png bytes'),
        filename: 'p.png',
        mimetype: 'image/png',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(double.removed).toEqual([[double.uploaded[0]]]);
  });
});

describe('an untick takes the line and its photos (561)', () => {
  it("deletes the line's files, then the line", async () => {
    setUp(OWN, storageDouble({ files: ['photo-1.png'] }));
    await workshops.removeInstructor(WORKSHOP, PAUL, 'u-lea');
    expect(double.removed).toEqual([[`${instructorPhotoFolder('wi-paul')}/photo-1.png`]]);
    expect(writesTo(db, 'workshop_instructors').map((write) => write.op)).toEqual(['delete']);
  });

  it('a storage failure refuses the untick before the line goes', async () => {
    setUp(OWN, storageDouble({ files: ['photo-1.png'], removeError: 'timeout' }));
    await expect(workshops.removeInstructor(WORKSHOP, PAUL, 'u-lea')).rejects.toThrow(
      /could not be deleted/,
    );
    expect(writesTo(db, 'workshop_instructors')).toEqual([]);
  });
});
