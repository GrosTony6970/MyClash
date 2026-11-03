import { Logger } from '@nestjs/common';
import { storedZipBytes, type StoredZipEntrySize } from '../../common/stored-zip';
import {
  ALLOWED_EVENT_HERO_MIME_TYPES,
  ALLOWED_EVENT_LOGO_MIME_TYPES,
  EVENT_HERO_UPLOAD,
  EVENT_LOGO_BUCKET,
  EVENT_LOGO_MAX_BYTES,
} from '../events/event-assets';
import type { SupabaseService } from '../supabase/supabase.service';
import {
  ALLOWED_WORKSHOP_LOGO_MIME_TYPES,
  WORKSHOP_LOGO_BUCKET,
  WORKSHOP_LOGO_MAX_BYTES,
} from '../workshops/workshop-assets';
import type { ArchiveRow } from './archive.table-spec';
import type { ArchiveScope, ArchiveTables } from './archive.types';

/**
 * The images an archive carries (rulings 403-410). An archive's rows keep their image LINKS; the
 * zip also carries the FILES stored on this server, and a restore stores each one again in the
 * copy's own folder and points the copy at it. A link to anywhere else stays a link: the server
 * never fetches a web address.
 */

type Storage = SupabaseService['service']['storage'];

/** The tables whose rows hold an image, in the order an export spends its room on them. */
export const IMAGE_TABLES = ['events', 'themes', 'tournaments', 'workshops'] as const;
export type ImageTable = (typeof IMAGE_TABLES)[number];

export interface ImageColumn {
  table: ImageTable;
  column: string;
  scopes: readonly ArchiveScope[];
  bucket: string;
  /** The bucket's own cap: an image over it could not be stored again. */
  bucketMaxBytes: number;
  maxBytes: number;
  mimeTypes: ReadonlySet<string>;
  /** The first word of the stored name, as the upload routes write it. */
  kind: 'logo' | 'hero';
}

/** The one list of carried images. A Tournament archive carries its logo only (ruling 407). */
export const ARCHIVE_IMAGE_COLUMNS: readonly ImageColumn[] = [
  {
    table: 'events',
    column: 'logo_url',
    scopes: ['event'],
    bucket: EVENT_LOGO_BUCKET,
    bucketMaxBytes: EVENT_LOGO_MAX_BYTES,
    maxBytes: EVENT_LOGO_MAX_BYTES,
    mimeTypes: ALLOWED_EVENT_LOGO_MIME_TYPES,
    kind: 'logo',
  },
  {
    table: 'themes',
    column: 'hero_image_url',
    scopes: ['event'],
    bucket: EVENT_LOGO_BUCKET,
    bucketMaxBytes: EVENT_LOGO_MAX_BYTES,
    maxBytes: EVENT_HERO_UPLOAD.maxBytes,
    mimeTypes: ALLOWED_EVENT_HERO_MIME_TYPES,
    kind: 'hero',
  },
  {
    table: 'tournaments',
    column: 'logo_url',
    scopes: ['event', 'tournament'],
    bucket: EVENT_LOGO_BUCKET,
    bucketMaxBytes: EVENT_LOGO_MAX_BYTES,
    maxBytes: EVENT_LOGO_MAX_BYTES,
    mimeTypes: ALLOWED_EVENT_LOGO_MIME_TYPES,
    kind: 'logo',
  },
  {
    table: 'workshops',
    column: 'cover_image_url',
    scopes: ['event'],
    bucket: WORKSHOP_LOGO_BUCKET,
    bucketMaxBytes: WORKSHOP_LOGO_MAX_BYTES,
    maxBytes: WORKSHOP_LOGO_MAX_BYTES,
    mimeTypes: ALLOWED_WORKSHOP_LOGO_MIME_TYPES,
    kind: 'logo',
  },
];

/** One row's image, by its table, its row id in the archive and its column. */
export interface ArchiveImageRef {
  table: ImageTable;
  rowId: string;
  column: string;
}

/** One image file of the zip, and every row that shows it. */
export interface ArchiveImage {
  refs: ArchiveImageRef[];
  entry: string;
  contentType: string;
  bytes: number;
}

export type ArchiveImageLeftOutReason = 'unreadable' | 'too_large' | 'not_image' | 'budget';

export interface ArchiveImageLeftOut extends ArchiveImageRef {
  reason: ArchiveImageLeftOutReason;
}

export interface ArchiveImages {
  carried: ArchiveImage[];
  leftOut: ArchiveImageLeftOut[];
}

const PUBLIC_PREFIX = '/storage/v1/object/public/';
const PATH_SEGMENT = /^[A-Za-z0-9._-]+$/u;
/** The extension of an image's zip entry and stored name, by its type. */
export const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const BUCKETS = new Set(ARCHIVE_IMAGE_COLUMNS.map((spec) => spec.bucket));
const logger = new Logger('ArchiveImages');

/**
 * The object of this server's storage a link names, or `null` for any other link. Found by its
 * storage path whatever the address in front of it (ruling 410), a short same-origin link
 * included. The RAW text is read, never a URL parser's result: a parser resolves `%2e%2e` and
 * `..` away, and they must be refused, not followed. Each path segment allows letters, digits,
 * `.`, `_` and `-` only, so `%`, `?`, `#` and `\` refuse the link there.
 */
export function storedObjectOf(link: unknown): { bucket: string; path: string } | null {
  if (typeof link !== 'string') return null;
  let pathname: string;
  if (link.startsWith(PUBLIC_PREFIX)) {
    pathname = link;
  } else {
    if (!/^https?:\/\//iu.test(link)) return null;
    const afterHost = link.indexOf('/', link.indexOf('//') + 2);
    if (afterHost < 0) return null;
    pathname = link.slice(afterHost);
  }
  if (!pathname.startsWith(PUBLIC_PREFIX)) return null;
  const [bucket, ...segments] = pathname.slice(PUBLIC_PREFIX.length).split('/');
  if (!bucket || !BUCKETS.has(bucket) || segments.length === 0) return null;
  const valid = segments.every(
    (segment) => PATH_SEGMENT.test(segment) && segment !== '.' && segment !== '..',
  );
  return valid ? { bucket, path: segments.join('/') } : null;
}

function columnsFor(scope: ArchiveScope): ImageColumn[] {
  return ARCHIVE_IMAGE_COLUMNS.filter((spec) => spec.scopes.includes(scope));
}

/** The list's row for an image ref, in this scope, or `undefined` for one outside it. */
export function specOf(ref: { table: string; column: string }, scope: ArchiveScope) {
  return columnsFor(scope).find((spec) => spec.table === ref.table && spec.column === ref.column);
}

interface Candidate {
  bucket: string;
  path: string;
  refs: ArchiveImageRef[];
  specs: ImageColumn[];
}

/** Every stored image the scope carries, one candidate per file (two rows may share one). */
function candidatesOf(scope: ArchiveScope, data: Partial<ArchiveTables>): Candidate[] {
  const byObject = new Map<string, Candidate>();
  for (const spec of columnsFor(scope)) {
    for (const row of (data[spec.table] ?? []) as ArchiveRow[]) {
      const object = storedObjectOf(row[spec.column]);
      if (!object || typeof row['id'] !== 'string') continue;
      const key = `${object.bucket}/${object.path}`;
      const candidate = byObject.get(key) ?? { ...object, refs: [], specs: [] };
      candidate.refs.push({ table: spec.table, rowId: row['id'], column: spec.column });
      candidate.specs.push(spec);
      byObject.set(key, candidate);
    }
  }
  return [...byObject.values()];
}

interface Downloaded {
  refs: ArchiveImageRef[];
  contentType: string;
  bytes: Buffer;
}

async function download(
  storage: Storage,
  candidate: Candidate,
): Promise<Downloaded | ArchiveImageLeftOutReason> {
  let bytes: Buffer;
  let type: string;
  try {
    // A body cut mid-read throws (`TypeError: terminated`) rather than answering an error.
    const { data, error } = await storage.from(candidate.bucket).download(candidate.path);
    if (error || !data) return 'unreadable';
    bytes = Buffer.from(await data.arrayBuffer());
    type = data.type;
  } catch {
    return 'unreadable';
  }
  const contentType = type.split(';')[0]!.trim().toLowerCase();
  if (candidate.specs.some((spec) => !spec.mimeTypes.has(contentType))) return 'not_image';
  if (candidate.specs.some((spec) => bytes.length > spec.maxBytes)) return 'too_large';
  return { refs: candidate.refs, contentType, bytes };
}

function entryName(index: number, contentType: string): string {
  return `images/${index + 1}.${EXTENSIONS[contentType]}`;
}

function leaveOut(
  leftOut: ArchiveImageLeftOut[],
  refs: ArchiveImageRef[],
  reason: ArchiveImageLeftOutReason,
) {
  for (const ref of refs) {
    leftOut.push({ ...ref, reason });
    logger.warn(`Archive image left out (${reason}): ${ref.table} ${ref.rowId} ${ref.column}`);
  }
}

/** What an export writes: the measured manifest and the image entries it names. Every
 *  manifest it returns is within both limits, or is the data as it stands. */
export interface CollectedImages {
  manifest: string;
  files: Record<string, Buffer>;
}

/** The exact length of the zip: the manifest, the other files and the chosen images. */
function zipBytesOf(
  manifest: string,
  otherEntries: readonly StoredZipEntrySize[],
  chosen: readonly Downloaded[],
): number {
  return storedZipBytes([
    { name: 'manifest.json', bytes: Buffer.byteLength(manifest, 'utf8') },
    ...otherEntries,
    ...chosen.map((image, index) => ({
      name: entryName(index, image.contentType),
      bytes: image.bytes.length,
    })),
  ]);
}

/** The manifest's `images` field for a choice, each image under the entry name of its place. */
function imagesField(chosen: readonly Downloaded[], leftOut: ArchiveImageLeftOut[]): ArchiveImages {
  return {
    carried: chosen.map((image, index) => ({
      refs: image.refs,
      entry: entryName(index, image.contentType),
      contentType: image.contentType,
      bytes: image.bytes.length,
    })),
    leftOut: [...leftOut],
  };
}

/**
 * Downloads the stored images of an archive and picks those that fit, so the zip never passes
 * `maxZipBytes` because of an image. `serialise` writes the manifest with a given `images`
 * field; the string it returns for the final choice is the one the zip must hold, since its size
 * is what was measured. `otherEntries` are the zip's other files (the reports). Data over
 * `maxDataBytes` makes a zip no restore takes (ruling 409): it gets no image at all.
 */
export async function collectArchiveImages(input: {
  storage: Storage;
  scope: ArchiveScope;
  data: Partial<ArchiveTables>;
  serialise: (images: ArchiveImages) => string;
  otherEntries: readonly StoredZipEntrySize[];
  maxZipBytes: number;
  maxDataBytes: number;
}): Promise<CollectedImages> {
  const leftOut: ArchiveImageLeftOut[] = [];
  const fitting: Downloaded[] = [];
  const zipBytes = (manifest: string, chosen: readonly Downloaded[]) =>
    zipBytesOf(manifest, input.otherEntries, chosen);

  // First pass, against the manifest as it stands: a big image may not fit where a later small one does.
  const base = input.serialise({ carried: [], leftOut: [] });
  if (Buffer.byteLength(base, 'utf8') > input.maxDataBytes) {
    logger.warn('Archive data over its limit: the zip carries no image (ruling 409)');
    return { manifest: base, files: {} };
  }
  for (const candidate of candidatesOf(input.scope, input.data)) {
    const result = await download(input.storage, candidate);
    if (typeof result === 'string') leaveOut(leftOut, candidate.refs, result);
    else if (zipBytes(base, [...fitting, result]) <= input.maxZipBytes) fitting.push(result);
    else leaveOut(leftOut, result.refs, 'budget');
  }

  return finalChoice({ ...input, zipBytes, base }, fitting, leftOut);
}

interface Measure {
  serialise: (images: ArchiveImages) => string;
  zipBytes: (manifest: string, chosen: readonly Downloaded[]) => number;
  maxZipBytes: number;
  maxDataBytes: number;
  /** The manifest with no image listed: it passed the data check. */
  base: string;
}

/**
 * The exact size, with the manifest that lists the choice. While the ZIP is over, the largest
 * image goes: each removal frees its bytes. When the DATA is over (listing images grows it),
 * one removal frees ~130 B at best, and removing them one by one would rewrite a 25 MB manifest
 * per image: every image goes at once instead.
 */
function finalChoice(m: Measure, fitting: Downloaded[], leftOut: ArchiveImageLeftOut[]) {
  const chosen = [...fitting];
  for (;;) {
    const manifest = m.serialise(imagesField(chosen, leftOut));
    if (Buffer.byteLength(manifest, 'utf8') > m.maxDataBytes || chosen.length === 0) {
      return withoutImages(m, chosen, leftOut);
    }
    if (m.zipBytes(manifest, chosen) <= m.maxZipBytes) {
      const files = Object.fromEntries(
        chosen.map((image, i) => [entryName(i, image.contentType), image.bytes]),
      );
      return { manifest, files };
    }
    const largest = chosen.reduce((max, image) =>
      image.bytes.length > max.bytes.length ? image : max,
    );
    chosen.splice(chosen.indexOf(largest), 1);
    leaveOut(leftOut, largest.refs, 'budget');
  }
}

/** No image carried: the left-out list if it fits, else the data as it stands. */
function withoutImages(
  m: Measure,
  chosen: readonly Downloaded[],
  leftOut: ArchiveImageLeftOut[],
): CollectedImages {
  for (const image of chosen) leaveOut(leftOut, image.refs, 'budget');
  const manifest = m.serialise(imagesField([], leftOut));
  const fits =
    Buffer.byteLength(manifest, 'utf8') <= m.maxDataBytes &&
    m.zipBytes(manifest, []) <= m.maxZipBytes;
  return { manifest: fits ? manifest : m.base, files: {} };
}
