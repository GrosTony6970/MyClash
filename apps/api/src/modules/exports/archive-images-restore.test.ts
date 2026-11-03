import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { ArchiveImages } from './archive-images';
import { imagesOfArchive, restoreArchiveImages } from './archive-images-restore';
import { eventRows, imageBytes, LOGO, makeStorage, PUBLIC } from './archive-images.fixtures';

const MIB = 1024 * 1024;

const carried = (
  overrides: Partial<ArchiveImages['carried'][number]> = {},
): ArchiveImages['carried'][number] => ({
  refs: [{ table: 'tournaments', rowId: 't-1', column: 'logo_url' }],
  entry: 'images/1.png',
  contentType: 'image/png',
  bytes: 10,
  ...overrides,
});

function check(
  images: unknown,
  entries = new Map([['images/1.png', imageBytes(10)]]),
  scope = 'event',
) {
  return imagesOfArchive({ scope: scope as 'event', images }, eventRows(), entries);
}

describe('imagesOfArchive: one check for the preview and the restore', () => {
  it('takes an image that holds to the list, a real row and its real bytes', () => {
    const result = check({ carried: [carried()], leftOut: [] });
    expect(result.keptLinks).toBe(0);
    expect(result.usable).toHaveLength(1);
    expect(result.usable[0]!.bytes).toEqual(imageBytes(10));
  });

  it.each([
    [
      'a table outside the list',
      carried({ refs: [{ table: 'persons', rowId: 'p-1', column: 'email' } as never] }),
      0,
    ],
    [
      'a column outside the list',
      carried({ refs: [{ table: 'tournaments', rowId: 't-1', column: 'status' }] }),
      0,
    ],
    [
      'a row the archive has not got',
      carried({ refs: [{ table: 'tournaments', rowId: 't-9', column: 'logo_url' }] }),
      0,
    ],
    ['an entry name we never write', carried({ entry: '../x.png' }), 1],
    ['an entry not in the zip', carried({ entry: 'images/2.png' }), 1],
    ['a length that is not its real one', carried({ bytes: 11 }), 1],
    ['a type that is no image', carried({ contentType: 'image/svg+xml' }), 1],
    ['a type its name does not carry', carried({ contentType: 'image/jpeg' }), 1],
  ])('%s → its link is kept', (_label, image, kept) => {
    const result = check({ carried: [image], leftOut: [] });
    expect(result.usable).toEqual([]);
    expect(result.keptLinks).toBe(kept);
  });

  it('keeps the link of an image over its cap, measured on the real bytes', () => {
    const big = imageBytes(10 * MIB + 1);
    const result = check(
      { carried: [carried({ bytes: big.length })], leftOut: [] },
      new Map([['images/1.png', big]]),
    );
    expect(result).toEqual({ usable: [], keptLinks: 1 });
  });

  it('holds a Tournament archive to its Tournament logos', () => {
    const hero = carried({ refs: [{ table: 'themes', rowId: 'th-1', column: 'hero_image_url' }] });
    expect(check({ carried: [hero], leftOut: [] }, undefined, 'tournament').usable).toEqual([]);
    expect(
      check({ carried: [carried()], leftOut: [] }, undefined, 'tournament').usable,
    ).toHaveLength(1);
  });

  it('counts the rows left out at export as kept links', () => {
    const leftOut = [{ table: 'events', rowId: 'event-1', column: 'logo_url', reason: 'budget' }];
    expect(check({ carried: [], leftOut }).keptLinks).toBe(1);
  });

  it('checks a crafted manifest of many refs over many rows in linear time', () => {
    // Any club admin can send a preview. 50,000 refs against 50,000 rows is 2.5 billion
    // comparisons when each ref scans the rows; an index answers it in milliseconds.
    const count = 50_000;
    const data = { tournaments: Array.from({ length: count }, (_, i) => ({ id: `t-${i}` })) };
    const leftOut = Array.from({ length: count }, (_, i) => ({
      table: 'tournaments',
      rowId: `t-${count - 1 - i}`,
      column: 'logo_url',
      reason: 'budget',
    }));
    const started = performance.now();
    const result = imagesOfArchive(
      { scope: 'event', images: { carried: [], leftOut } },
      data,
      new Map(),
    );
    expect(result.keptLinks).toBe(count);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it.each([
    ['absent', undefined],
    ['not an object', 'x'],
    ['without its lists', { carried: 'x' }],
    ['with a bad image', { carried: [{ entry: 1 }], leftOut: [] }],
  ])('reads an images field %s as absent: 0 / 0, the archive still read', (_label, images) => {
    expect(check(images)).toEqual({ usable: [], keptLinks: 0 });
  });
});

describe('restoreArchiveImages: each image in the copy’s own folder', () => {
  const NEW_IDS: Record<string, string> = {
    'events:event-1': 'event-new',
    'tournaments:t-1': 't-new',
    'tournaments:t-2': 't2-new',
    'themes:th-1': 'th-new',
    'workshops:w-1': 'w-new',
  };
  const newIdOf = (table: string, id: string) => NEW_IDS[`${table}:${id}`];

  function usableOf(images: ArchiveImages['carried'], entries: Map<string, Buffer>) {
    return imagesOfArchive(
      { scope: 'event', images: { carried: images, leftOut: [] } },
      eventRows(),
      entries,
    ).usable;
  }

  it('stores each image under a name made here and points every row that shows it there', async () => {
    const { storage, uploads } = makeStorage();
    const data = eventRows();
    // The root row is already rewritten to its new id when the restore reaches this.
    data.events[0]!['id'] = 'event-new';
    const usable = usableOf(
      [
        carried({
          refs: [
            { table: 'events', rowId: 'event-1', column: 'logo_url' },
            { table: 'tournaments', rowId: 't-2', column: 'logo_url' },
          ],
        }),
        carried({
          refs: [{ table: 'themes', rowId: 'th-1', column: 'hero_image_url' }],
          entry: 'images/2.jpg',
          contentType: 'image/jpeg',
        }),
        carried({
          refs: [{ table: 'workshops', rowId: 'w-1', column: 'cover_image_url' }],
          entry: 'images/3.png',
        }),
      ],
      new Map([
        ['images/1.png', imageBytes(10, 1)],
        ['images/2.jpg', imageBytes(10, 2)],
        ['images/3.png', imageBytes(10, 3)],
      ]),
    );

    const kept = await restoreArchiveImages(storage as never, data, newIdOf, usable);

    expect(kept).toBe(0);
    expect(
      uploads.map((upload) => [upload.bucket, upload.path.replace(/-\d+-/u, '-T-'), upload.upsert]),
    ).toEqual([
      ['event-assets', 'events/event-new/logo-T-1.png', false],
      // The hero lives in the NEW Event's folder, found through its row's event id.
      ['event-assets', 'events/event-new/hero-T-2.jpg', false],
      ['workshop-assets', 'workshops/w-new/logo-T-3.png', false],
    ]);
    expect(uploads[0]!.bytes).toEqual(imageBytes(10, 1));
    const url = (index: number) => `${PUBLIC}/${uploads[index]!.bucket}/${uploads[index]!.path}`;
    expect(data.events[0]!['logo_url']).toBe(url(0));
    // A file two rows share lives in its first row's folder.
    expect(data.tournaments.find((row) => row['id'] === 't-2')!['logo_url']).toBe(url(0));
    expect(data.themes[0]!['hero_image_url']).toBe(url(1));
    expect(data.workshops[0]!['cover_image_url']).toBe(url(2));
    // The bucket of a new server is made once per restore.
    expect(storage.createBucket.mock.calls.map(([name]) => name)).toEqual([
      'event-assets',
      'workshop-assets',
    ]);
  });

  it('keeps the old link of an image storage refuses, and counts each row (ruling 408)', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { storage, uploads } = makeStorage(
      {},
      { refuseUpload: (path) => path.startsWith('events/') },
    );
    const data = eventRows();
    const usable = usableOf(
      [
        carried({
          refs: [
            { table: 'events', rowId: 'event-1', column: 'logo_url' },
            { table: 'tournaments', rowId: 't-2', column: 'logo_url' },
          ],
        }),
        carried({ entry: 'images/2.png' }),
      ],
      new Map([
        ['images/1.png', imageBytes(10)],
        ['images/2.png', imageBytes(10)],
      ]),
    );

    const kept = await restoreArchiveImages(storage as never, data, newIdOf, usable);

    expect(kept).toBe(2);
    expect(data.events[0]!['logo_url']).toBe(LOGO);
    expect(uploads.map((upload) => upload.path.split('/').slice(0, 2).join('/'))).toEqual([
      'tournaments/t-new',
    ]);
    expect(data.tournaments[0]!['logo_url']).toBe(`${PUBLIC}/event-assets/${uploads[0]!.path}`);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(
      /^Archive image kept its old link: events\/event-new\/logo-/u,
    );
    warn.mockRestore();
  });

  it('makes no storage call at all when the archive carries no image', async () => {
    const storage = new Proxy(
      {},
      {
        get: () => {
          throw new Error('storage touched');
        },
      },
    );
    await expect(restoreArchiveImages(storage as never, eventRows(), newIdOf, [])).resolves.toBe(0);
  });
});
