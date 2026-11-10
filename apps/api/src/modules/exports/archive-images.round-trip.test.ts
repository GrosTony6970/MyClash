import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readStoredZip } from '../../common/stored-zip';
import { imageBytes, makeStorage, PUBLIC } from './archive-images.fixtures';
import { makeService } from './archive.fixtures';

/**
 * The whole path, through the archive service: an export writes the stored images into the zip,
 * and a restore of that zip stores each one again in the copy's own folder (rulings 403-410).
 */

const EVENT_LOGO = `${PUBLIC}/event-assets/events/ev-src/logo-1-fal.png`;
const MISSING = `${PUBLIC}/event-assets/tournaments/tour-d/logo-1.png`;
const OUTSIDE = 'https://cdn.example.com/club.png';

const rows = () => ({
  events: [
    {
      id: 'ev-src',
      organization_id: 'org-1',
      slug: 'fal',
      name: 'FAL',
      status: 'completed',
      logo_url: EVENT_LOGO,
    },
  ],
  themes: [
    {
      id: 'theme-src',
      event_id: 'ev-src',
      hero_image_url: `${PUBLIC}/event-assets/events/ev-src/hero-1.jpg`,
    },
  ],
  tournaments: [
    {
      id: 'tour-a',
      event_id: 'ev-src',
      slug: 'ls',
      name: 'LS',
      logo_url: `${PUBLIC}/event-assets/tournaments/tour-a/logo-1.webp`,
    },
    // The Event's logo, pasted as this Tournament's.
    { id: 'tour-b', event_id: 'ev-src', slug: 'sa', name: 'SA', logo_url: EVENT_LOGO },
    { id: 'tour-c', event_id: 'ev-src', slug: 'rp', name: 'RP', logo_url: OUTSIDE },
    // A file the server no longer has.
    { id: 'tour-d', event_id: 'ev-src', slug: 'ms', name: 'MS', logo_url: MISSING },
  ],
  workshops: [
    {
      id: 'ws-src',
      event_id: 'ev-src',
      title: 'Drills',
      cover_image_url: `${PUBLIC}/workshop-assets/workshops/ws-src/logo-1.png`,
    },
  ],
});

const OBJECTS = {
  'event-assets/events/ev-src/logo-1-fal.png': { bytes: imageBytes(100, 1), type: 'image/png' },
  'event-assets/events/ev-src/hero-1.jpg': { bytes: imageBytes(200, 2), type: 'image/jpeg' },
  'event-assets/tournaments/tour-a/logo-1.webp': { bytes: imageBytes(300, 3), type: 'image/webp' },
  'workshop-assets/workshops/ws-src/logo-1.png': { bytes: imageBytes(400, 4), type: 'image/png' },
};

const SOURCE_IDS = ['ev-src', 'theme-src', 'tour-a', 'tour-b', 'tour-c', 'tour-d', 'ws-src'];
const CONFIRM = 'RESTORE MYCLASH ARCHIVE';

/** Where the stored file a link names lives, if it is one of ours. */
const pathOf = (link: unknown) => String(link).slice(PUBLIC.length + 1);

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

describe('an Event archive carries its images and its copy owns them', () => {
  async function exportEvent() {
    const objects = makeStorage(OBJECTS);
    const { service } = makeService(rows(), undefined, objects.storage);
    const archive = await service.generateEventArchive('ev-src', 'user-1', {
      include: 'structure',
    });
    return { archive, zip: await service.archiveToZipBuffer(archive) };
  }

  it('restores a copy whose images are its own files, on a server that has none of them', async () => {
    const { zip } = await exportEvent();
    // Another server: empty storage, no bucket.
    const target = makeStorage();
    const { service, inserted } = makeService(rows(), undefined, target.storage);

    const preview = await service.previewRestore(zip, 'user-1');
    const result = await service.restoreArchiveCopy(zip, 'user-1', {
      targetOrganizationId: 'org-1',
      confirmation: CONFIRM,
    });

    const event = inserted.events![0]!;
    const theme = inserted.themes![0]!;
    const tournament = (slug: string) => inserted.tournaments!.find((row) => row['slug'] === slug)!;
    const workshop = inserted.workshops![0]!;

    // Each restored link names a file of this server, in the folder of the copy's own row.
    expect(pathOf(event['logo_url'])).toMatch(
      new RegExp(`^event-assets/events/${String(event['id'])}/logo-\\d+-\\d\\.png$`, 'u'),
    );
    expect(pathOf(theme['hero_image_url'])).toMatch(
      new RegExp(`^event-assets/events/${String(event['id'])}/hero-`, 'u'),
    );
    expect(pathOf(tournament('ls')['logo_url'])).toMatch(
      new RegExp(`^event-assets/tournaments/${String(tournament('ls')['id'])}/logo-`, 'u'),
    );
    expect(pathOf(workshop['cover_image_url'])).toMatch(
      new RegExp(`^workshop-assets/workshops/${String(workshop['id'])}/logo-`, 'u'),
    );
    // A file two rows shared is stored once, in its first row's folder.
    expect(tournament('sa')['logo_url']).toBe(event['logo_url']);

    // The bytes that went out are the bytes that came in.
    const stored = (link: unknown) => target.store.get(pathOf(link))!.bytes;
    expect(stored(event['logo_url'])).toEqual(imageBytes(100, 1));
    expect(stored(theme['hero_image_url'])).toEqual(imageBytes(200, 2));
    expect(stored(tournament('ls')['logo_url'])).toEqual(imageBytes(300, 3));
    expect(stored(workshop['cover_image_url'])).toEqual(imageBytes(400, 4));
    expect(target.uploads).toHaveLength(4);

    // No restored image link names a row of the source…
    const links = [
      event['logo_url'],
      theme['hero_image_url'],
      ...inserted.tournaments!.map((row) => row['logo_url']),
      workshop['cover_image_url'],
    ].map(String);
    const survivors = links.filter((link) => SOURCE_IDS.some((id) => link.includes(id)));
    // …except the ones that keep their link on purpose, asserted positively.
    expect(survivors).toEqual([MISSING]);
    expect(tournament('rp')['logo_url']).toBe(OUTSIDE);
    expect(tournament('ms')['logo_url']).toBe(MISSING);

    // The preview said what the restore did: 5 rows get their own file, 1 keeps its link
    // (the file the source server had lost), and storage refused nothing.
    expect([preview.images, preview.imagesKept]).toEqual([5, 1]);
    expect(result.imagesKept).toBe(0);
  });

  it('gives a copy restored on the SAME server files distinct from the source', async () => {
    const { zip } = await exportEvent();
    const same = makeStorage(OBJECTS);
    const { service, inserted } = makeService(rows(), undefined, same.storage);
    await service.restoreArchiveCopy(zip, 'user-1', {
      targetOrganizationId: 'org-1',
      confirmation: CONFIRM,
    });

    expect(inserted.events![0]!['logo_url']).not.toBe(EVENT_LOGO);
    expect(same.store.has('event-assets/events/ev-src/logo-1-fal.png')).toBe(true);
    expect(same.uploads.every((upload) => !SOURCE_IDS.some((id) => upload.path.includes(id)))).toBe(
      true,
    );
  });

  it('keeps the source links in a restore of the JSON download, which has no images (ruling 405)', async () => {
    const { archive } = await exportEvent();
    expect(archive).not.toHaveProperty('images');
    const { service, inserted } = makeService(rows());
    const preview = await service.previewRestore(Buffer.from(JSON.stringify(archive)), 'user-1');
    await service.restoreArchiveCopy(Buffer.from(JSON.stringify(archive)), 'user-1', {
      targetOrganizationId: 'org-1',
      confirmation: CONFIRM,
    });
    expect([preview.images, preview.imagesKept]).toEqual([0, 0]);
    expect(inserted.events![0]!['logo_url']).toBe(EVENT_LOGO);
  });

  it('restores the copy when storage refuses an image: that row keeps its link (ruling 408)', async () => {
    const { zip } = await exportEvent();
    const target = makeStorage({}, { refuseUpload: (path) => path.startsWith('workshops/') });
    const { service, inserted } = makeService(rows(), undefined, target.storage);
    const result = await service.restoreArchiveCopy(zip, 'user-1', {
      targetOrganizationId: 'org-1',
      confirmation: CONFIRM,
    });
    expect(result.imagesKept).toBe(1);
    expect(inserted.workshops![0]!['cover_image_url']).toBe(rows().workshops[0]!.cover_image_url);
    expect(inserted.events![0]!['logo_url']).not.toBe(EVENT_LOGO);
  });

  it('writes the zip entries the manifest names, and nothing more', async () => {
    const { zip } = await exportEvent();
    const entries = readStoredZip(zip);
    const manifest = JSON.parse(entries.get('manifest.json')!.toString('utf8')) as {
      images: { carried: { entry: string }[] };
    };
    expect([...entries.keys()].filter((name) => name.startsWith('images/')).sort()).toEqual(
      manifest.images.carried.map((image) => image.entry).sort(),
    );
  });
});

/**
 * A Workshop's photo of one of its instructors (2.6b): stored by its upload route with a SAME-ORIGIN
 * link, and on a table whose archive key is not its name (`workshopInstructors`).
 */
describe("an Event archive carries a Workshop's photo of its instructor", () => {
  const LINE_PHOTO =
    '/storage/v1/object/public/workshop-assets/workshop_instructors/wi-src/photo-1.png';
  const withLine = () => ({
    ...rows(),
    workshop_instructors: [
      {
        id: 'wi-src',
        workshop_id: 'ws-src',
        global_person_id: null,
        display_name: 'Paul',
        photo_url: LINE_PHOTO,
      },
    ],
  });
  const objects = {
    ...OBJECTS,
    'workshop-assets/workshop_instructors/wi-src/photo-1.png': {
      bytes: imageBytes(500, 5),
      type: 'image/png',
    },
  };

  it("restores it as a file of the copy's own line", async () => {
    const source = makeService(withLine(), undefined, makeStorage(objects).storage).service;
    const archive = await source.generateEventArchive('ev-src', 'user-1', {
      include: 'structure',
    });
    const zip = await source.archiveToZipBuffer(archive);
    const target = makeStorage();
    const { service, inserted } = makeService(withLine(), undefined, target.storage);
    await service.restoreArchiveCopy(zip, 'user-1', {
      targetOrganizationId: 'org-1',
      confirmation: CONFIRM,
    });

    const line = inserted.workshop_instructors![0]!;
    expect(pathOf(line['photo_url'])).toMatch(
      new RegExp(
        `^workshop-assets/workshop_instructors/${String(line['id'])}/photo-\\d+-\\d\\.png$`,
        'u',
      ),
    );
    expect(target.store.get(pathOf(line['photo_url']))!.bytes).toEqual(imageBytes(500, 5));
  });
});

describe('a Tournament archive carries its logo only (ruling 407)', () => {
  it('restores into its own Event with a logo of its own, and no Event image', async () => {
    const objects = makeStorage(OBJECTS);
    const { service } = makeService(rows(), undefined, objects.storage);
    const archive = await service.generateTournamentArchive('tour-a', 'user-1', {
      include: 'structure',
    });
    const zip = await service.archiveToZipBuffer(archive);
    expect([...readStoredZip(zip).keys()].filter((name) => name.startsWith('images/'))).toEqual([
      'images/1.webp',
    ]);

    const target = makeStorage(OBJECTS);
    const restore = makeService(rows(), undefined, target.storage);
    const result = await restore.service.restoreArchiveCopy(zip, 'user-1', {
      targetEventId: 'ev-src',
      confirmation: CONFIRM,
    });

    const restored = restore.inserted.tournaments![0]!;
    expect(restored['id']).toBe(result.restoredTournamentId);
    expect(pathOf(restored['logo_url'])).toMatch(
      new RegExp(`^event-assets/tournaments/${String(result.restoredTournamentId)}/logo-`, 'u'),
    );
    expect(target.uploads.map((upload) => upload.path.split('/')[0])).toEqual(['tournaments']);
  });
});
