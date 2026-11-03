import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { createStoredZip, storedZipBytes } from '../../common/stored-zip';
import { collectArchiveImages, storedObjectOf, type ArchiveImages } from './archive-images';
import {
  eventObjects,
  eventRows,
  imageBytes,
  LOGO,
  makeStorage,
  PUBLIC,
  tables,
} from './archive-images.fixtures';
import type { ArchiveTables } from './archive.types';

const MIB = 1024 * 1024;

describe('storedObjectOf: a link names an object of our storage, or nothing', () => {
  it.each([
    [LOGO, { bucket: 'event-assets', path: 'events/event-1/logo-1-fal.png' }],
    // Ruling 410: found by its path whatever the address in front of it.
    [
      'https://app.old-name.fr/storage/v1/object/public/workshop-assets/workshops/w-1/logo-2.webp',
      { bucket: 'workshop-assets', path: 'workshops/w-1/logo-2.webp' },
    ],
    // …a short same-origin link included (the form club logos are written in).
    [
      '/storage/v1/object/public/event-assets/tournaments/t-1/logo-3.jpg',
      { bucket: 'event-assets', path: 'tournaments/t-1/logo-3.jpg' },
    ],
  ])('%s → its object', (link, object) => {
    expect(storedObjectOf(link)).toEqual(object);
  });

  it.each([
    ['an outside address', 'https://cdn.example.com/logo.png'],
    ['another bucket', `${PUBLIC}/fighter-photos/p-1.jpg`],
    [
      'a private object',
      'https://app.myclash.test/storage/v1/object/authenticated/event-assets/x.png',
    ],
    ['a bucket with no path', `${PUBLIC}/event-assets`],
    ['a `..` segment', `${PUBLIC}/event-assets/events/../../authenticated/x.png`],
    ['a `.` segment', `${PUBLIC}/event-assets/./events/x.png`],
    ['an encoded `..`', `${PUBLIC}/event-assets/events/%2e%2e/x.png`],
    ['a query', `${LOGO}?x=1`],
    ['a fragment', `${LOGO}#x`],
    ['a backslash', `${PUBLIC}/event-assets/events\\x.png`],
    ['another scheme', 'ftp://app.myclash.test/storage/v1/object/public/event-assets/x.png'],
    ['not a link', 'logo.png'],
    ['a number', 12],
    ['nothing', null],
  ])('%s → null', (_label, link) => {
    expect(storedObjectOf(link)).toBeNull();
  });
});

function collect(
  storage: ReturnType<typeof makeStorage>['storage'],
  data: ArchiveTables,
  maxZipBytes = 50 * MIB,
  scope: 'event' | 'tournament' = 'event',
  maxDataBytes = 25 * MIB,
) {
  const archive = { scope, data };
  return collectArchiveImages({
    storage: storage as never,
    scope,
    data,
    serialise: (images) => JSON.stringify({ ...archive, images }, null, 2),
    otherEntries: [{ name: 'reports/Fête/matches.csv', bytes: Buffer.byteLength('a,é\n') }],
    maxZipBytes,
    maxDataBytes,
  });
}

function parsedImages(manifest: string): ArchiveImages {
  return (JSON.parse(manifest) as { images: ArchiveImages }).images;
}

describe('collectArchiveImages: the export carries the stored images that fit', () => {
  it('carries each stored file once, with every row that shows it, and leaves outside links', async () => {
    const { storage } = makeStorage(eventObjects());
    const { manifest, files } = await collect(storage, eventRows());
    const images = parsedImages(manifest);

    expect(images.carried.map((image) => image.refs)).toEqual([
      [
        { table: 'events', rowId: 'event-1', column: 'logo_url' },
        { table: 'tournaments', rowId: 't-2', column: 'logo_url' },
      ],
      [{ table: 'themes', rowId: 'th-1', column: 'hero_image_url' }],
      [{ table: 'tournaments', rowId: 't-1', column: 'logo_url' }],
      [{ table: 'workshops', rowId: 'w-1', column: 'cover_image_url' }],
    ]);
    expect(images.carried.map((image) => [image.entry, image.contentType, image.bytes])).toEqual([
      ['images/1.png', 'image/png', 100],
      ['images/2.jpg', 'image/jpeg', 200],
      ['images/3.webp', 'image/webp', 300],
      ['images/4.png', 'image/png', 400],
    ]);
    expect(images.leftOut).toEqual([]);
    expect(files['images/1.png']).toEqual(imageBytes(100, 1));
    expect(files['images/4.png']).toEqual(imageBytes(400, 4));
  });

  it('carries only the Tournament logos in a Tournament archive (ruling 407)', async () => {
    const { storage } = makeStorage(eventObjects());
    const { manifest } = await collect(storage, eventRows(), 50 * MIB, 'tournament');
    const refs = parsedImages(manifest).carried.flatMap((image) => image.refs);
    expect(refs.map((ref) => `${ref.table}:${ref.rowId}`)).toEqual([
      'tournaments:t-1',
      'tournaments:t-2',
    ]);
  });

  it('leaves out, with its reason and a log line, an image it cannot carry', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const objects = {
      // events logo: missing → unreadable
      'event-assets/events/event-1/hero-1.jpg': { bytes: imageBytes(10), type: 'image/svg+xml' },
      'event-assets/tournaments/t-1/logo-1.webp': {
        bytes: imageBytes(10 * MIB + 1),
        type: 'image/webp',
      },
    };
    const { storage } = makeStorage(objects);
    const data = eventRows();
    data.workshops = [];
    const { manifest, files } = await collect(storage, data);
    const images = parsedImages(manifest);

    expect(images.carried).toEqual([]);
    expect(images.leftOut.map((row) => `${row.table}:${row.rowId}:${row.reason}`)).toEqual([
      'events:event-1:unreadable',
      'tournaments:t-2:unreadable',
      'themes:th-1:not_image',
      'tournaments:t-1:too_large',
    ]);
    expect(files).toEqual({});
    expect(warn.mock.calls.map(([line]) => line)).toEqual([
      'Archive image left out (unreadable): events event-1 logo_url',
      'Archive image left out (unreadable): tournaments t-2 logo_url',
      'Archive image left out (not_image): themes th-1 hero_image_url',
      'Archive image left out (too_large): tournaments t-1 logo_url',
    ]);
    warn.mockRestore();
  });

  it('skips an image over the room left and still carries a later one that fits', async () => {
    const objects = {
      'event-assets/events/event-1/logo-1-fal.png': { bytes: imageBytes(5000), type: 'image/png' },
      'event-assets/events/event-1/hero-1.jpg': { bytes: imageBytes(50), type: 'image/jpeg' },
    };
    const data = tables({ events: eventRows().events, themes: eventRows().themes });
    const { storage } = makeStorage(objects);
    const { manifest, files } = await collect(storage, data, 4000);
    const images = parsedImages(manifest);

    expect(images.leftOut.map((row) => `${row.table}:${row.reason}`)).toEqual(['events:budget']);
    expect(images.carried.map((image) => image.refs[0]!.table)).toEqual(['themes']);
    expect(Object.keys(files)).toEqual(['images/1.jpg']);
  });

  it('measures the zip it writes exactly, so the final manifest never pushes it over', async () => {
    const { storage } = makeStorage(eventObjects());
    const data = eventRows();
    // The exact size of the zip with all four images, then a limit just under it: only the
    // final measure (the manifest that lists the choice) can see the images no longer fit.
    const all = await collect(storage, data);
    const reports = { 'reports/Fête/matches.csv': 'a,é\n' };
    const full = createStoredZip({
      'manifest.json': all.manifest,
      ...reports,
      ...all.files,
    }).length;

    const tight = await collect(storage, data, full - 1);
    const zip = createStoredZip({ 'manifest.json': tight.manifest, ...reports, ...tight.files });
    const images = parsedImages(tight.manifest);

    expect(zip.length).toBeLessThanOrEqual(full - 1);
    // The largest went (the Workshop cover, 400 B), the rest stayed.
    expect(images.leftOut).toEqual([
      { table: 'workshops', rowId: 'w-1', column: 'cover_image_url', reason: 'budget' },
    ]);
    expect(images.carried).toHaveLength(3);
  });

  it('carries no image, and reads none, when the data is over what a restore takes (409)', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { storage } = makeStorage(eventObjects());
    const { manifest, files } = await collect(storage, eventRows(), 50 * MIB, 'event', 100);
    expect(files).toEqual({});
    expect(parsedImages(manifest)).toEqual({ carried: [], leftOut: [] });
    expect(storage.from).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'Archive data over its limit: the zip carries no image (ruling 409)',
    );
    warn.mockRestore();
  });

  it('leaves out an image whose read breaks mid-body, and still writes the zip', async () => {
    const { storage } = makeStorage(eventObjects());
    const real = storage.from.getMockImplementation()!;
    storage.from.mockImplementation((bucket: string) => {
      const api = real(bucket);
      if (bucket !== 'workshop-assets') return api;
      return { ...api, download: vi.fn(async () => Promise.reject(new TypeError('terminated'))) };
    });
    const { manifest } = await collect(storage, eventRows());
    const images = parsedImages(manifest);
    expect(images.carried).toHaveLength(3);
    expect(images.leftOut).toEqual([
      { table: 'workshops', rowId: 'w-1', column: 'cover_image_url', reason: 'unreadable' },
    ]);
  });

  it('leaves every image out when the data alone is over the limit', async () => {
    const { storage } = makeStorage(eventObjects());
    const { manifest, files } = await collect(storage, eventRows(), 100);
    expect(files).toEqual({});
    expect(parsedImages(manifest).carried).toEqual([]);
  });

  it('falls back to the data as it stands when not even the left-out list fits', async () => {
    // One 1-byte image that fits beside the manifest as it stands, and a limit of exactly that:
    // listing it grows the manifest past the limit, and so does listing it as left out. Only
    // the stop on an empty choice ends the loop, on the manifest the first check passed.
    const data = tables({ events: [{ id: 'event-1', logo_url: LOGO }] });
    const { storage } = makeStorage({
      'event-assets/events/event-1/logo-1-fal.png': { bytes: imageBytes(1), type: 'image/png' },
    });
    const base = JSON.stringify(
      { scope: 'event', data, images: { carried: [], leftOut: [] } },
      null,
      2,
    );
    const limit = storedZipBytes([
      { name: 'manifest.json', bytes: Buffer.byteLength(base) },
      { name: 'reports/Fête/matches.csv', bytes: Buffer.byteLength('a,é\n') },
      { name: 'images/1.png', bytes: 1 },
    ]);

    const { manifest, files } = await collect(storage, data, limit);

    expect(files).toEqual({});
    expect(manifest).toBe(base);
  });

  it('rewrites the manifest a fixed number of times when the data limit binds', async () => {
    // 300 tiny distinct logos beside data a few bytes under its limit: one removal frees
    // ~130 B of manifest, so removing them one by one would rewrite it 300 times.
    const count = 300;
    const tournaments = Array.from({ length: count }, (_, i) => ({
      id: `t-${i}`,
      logo_url: `${PUBLIC}/event-assets/tournaments/t-${i}/logo-1.png`,
    }));
    const objects = Object.fromEntries(
      tournaments.map((row) => [
        `event-assets/tournaments/${row.id}/logo-1.png`,
        { bytes: imageBytes(3), type: 'image/png' },
      ]),
    );
    const { storage } = makeStorage(objects);
    const data = tables({ tournaments });
    const write = (images: ArchiveImages) =>
      JSON.stringify({ scope: 'event', data, images }, null, 2);
    const serialise = vi.fn(write);
    const base = write({ carried: [], leftOut: [] });

    const { manifest, files } = await collectArchiveImages({
      storage: storage as never,
      scope: 'event',
      data,
      serialise,
      otherEntries: [],
      maxZipBytes: 50 * MIB,
      maxDataBytes: Buffer.byteLength(base) + 10,
    });

    expect(files).toEqual({});
    expect(manifest).toBe(base);
    // The base, the listing that is over, the list of what was left out: three.
    expect(serialise).toHaveBeenCalledTimes(3);
  });

  it('never lets the list of images push the data over what a restore takes (409)', async () => {
    // Data a few bytes under its limit: carrying any image would list it, and the restore would
    // then refuse a zip that restores without images.
    const { storage } = makeStorage(eventObjects());
    const data = eventRows();
    const base = JSON.stringify(
      { scope: 'event', data, images: { carried: [], leftOut: [] } },
      null,
      2,
    );
    const maxData = Buffer.byteLength(base) + 10;

    const { manifest, files } = await collect(storage, data, 50 * MIB, 'event', maxData);

    expect(Buffer.byteLength(manifest)).toBeLessThanOrEqual(maxData);
    expect(manifest).toBe(base);
    expect(files).toEqual({});
  });
});
