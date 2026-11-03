/**
 * A storage double for the archive's image tests: objects by `<bucket>/<path>`, uploads recorded
 * and readable afterwards, public links on a fixed origin. Imported by tests and nothing else.
 */
import { vi } from 'vitest';
import { emptyArchiveTables } from './archive.tables';
import type { ArchiveTables } from './archive.types';

export const STORAGE_ORIGIN = 'https://app.myclash.test';
export const PUBLIC = `${STORAGE_ORIGIN}/storage/v1/object/public`;

export interface StoredObject {
  bytes: Buffer;
  type: string;
}

export interface Upload extends StoredObject {
  bucket: string;
  path: string;
  upsert: boolean | undefined;
}

export function makeStorage(
  objects: Record<string, StoredObject> = {},
  options: { refuseUpload?: (path: string) => boolean } = {},
) {
  const store = new Map(Object.entries(objects));
  const uploads: Upload[] = [];
  const buckets = new Set<string>();
  const from = vi.fn((bucket: string) => ({
    download: vi.fn(async (path: string) => {
      const object = store.get(`${bucket}/${path}`);
      if (!object) return { data: null, error: { message: 'Object not found' } };
      return { data: new Blob([new Uint8Array(object.bytes)], { type: object.type }), error: null };
    }),
    upload: vi.fn(
      async (path: string, bytes: Buffer, opts: { contentType: string; upsert?: boolean }) => {
        if (options.refuseUpload?.(path)) return { data: null, error: { message: 'refused' } };
        if (store.has(`${bucket}/${path}`) && !opts.upsert) {
          return { data: null, error: { message: 'The resource already exists' } };
        }
        store.set(`${bucket}/${path}`, { bytes, type: opts.contentType });
        uploads.push({ bucket, path, bytes, type: opts.contentType, upsert: opts.upsert });
        return { data: { path }, error: null };
      },
    ),
    getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: `${PUBLIC}/${bucket}/${path}` } })),
  }));
  const storage = {
    from,
    getBucket: vi.fn(async (name: string) =>
      buckets.has(name)
        ? { data: { name }, error: null }
        : { data: null, error: { message: 'Bucket not found' } },
    ),
    createBucket: vi.fn(async (name: string) => {
      buckets.add(name);
      return { data: { name }, error: null };
    }),
  };
  return { storage, uploads, buckets, store };
}

/** Bytes that read as an image of `size` bytes: the content is never decoded. */
export function imageBytes(size: number, fill = 7): Buffer {
  return Buffer.alloc(size, fill);
}

/** An Event with each kind of carried image, one file shared by two rows, and an outside link. */
export const LOGO = `${PUBLIC}/event-assets/events/event-1/logo-1-fal.png`;

export function tables(rows: Partial<ArchiveTables>): ArchiveTables {
  return { ...emptyArchiveTables(), ...rows };
}

export const eventRows = () =>
  tables({
    events: [{ id: 'event-1', name: 'Fête é', logo_url: LOGO }],
    themes: [
      {
        id: 'th-1',
        event_id: 'event-1',
        hero_image_url: `${PUBLIC}/event-assets/events/event-1/hero-1.jpg`,
      },
    ],
    tournaments: [
      {
        id: 't-1',
        event_id: 'event-1',
        logo_url: `${PUBLIC}/event-assets/tournaments/t-1/logo-1.webp`,
      },
      // The Event's own logo, pasted as this Tournament's: one file, two rows.
      { id: 't-2', event_id: 'event-1', logo_url: LOGO },
      { id: 't-3', event_id: 'event-1', logo_url: 'https://cdn.example.com/x.png' },
    ],
    workshops: [
      {
        id: 'w-1',
        event_id: 'event-1',
        cover_image_url: `${PUBLIC}/workshop-assets/workshops/w-1/logo-1.png`,
      },
    ],
  });

export const eventObjects = () => ({
  'event-assets/events/event-1/logo-1-fal.png': { bytes: imageBytes(100, 1), type: 'image/png' },
  'event-assets/events/event-1/hero-1.jpg': { bytes: imageBytes(200, 2), type: 'image/jpeg' },
  'event-assets/tournaments/t-1/logo-1.webp': { bytes: imageBytes(300, 3), type: 'image/webp' },
  'workshop-assets/workshops/w-1/logo-1.png': { bytes: imageBytes(400, 4), type: 'image/png' },
});
