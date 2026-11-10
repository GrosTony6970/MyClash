import { Logger } from '@nestjs/common';
import { ensurePublicBucket } from '../../common/storage-bucket';
import type { SupabaseService } from '../supabase/supabase.service';
import {
  EXTENSIONS,
  specOf,
  type ArchiveImageRef,
  type ArchiveImages,
  type ImageColumn,
  type ImageTable,
  IMAGE_TABLES,
  imageRowsOf,
} from './archive-images';
import type { ArchiveRow } from './archive.table-spec';
import type { ArchiveScope, ArchiveTables } from './archive.types';

/**
 * The restore half of the archive's images (`archive-images.ts` is the export half and the list):
 * the check the preview and the restore share, and the step that stores each image again in the
 * copy's own folder.
 */

type Storage = SupabaseService['service']['storage'];

const ENTRY = /^images\/\d+\.(png|jpg|webp)$/u;
const logger = new Logger('ArchiveImages');

/** The `images` field of a manifest, or `null` when it is absent or of a bad shape (ruling 408). */
function imagesOf(archive: { images?: unknown }): ArchiveImages | null {
  const images = archive.images as Partial<ArchiveImages> | undefined;
  if (!images || !Array.isArray(images.carried) || !Array.isArray(images.leftOut)) return null;
  const isRef = (ref: unknown) => {
    const r = ref as Partial<ArchiveImageRef> | null;
    return (
      !!r &&
      typeof r.table === 'string' &&
      typeof r.rowId === 'string' &&
      typeof r.column === 'string'
    );
  };
  const shaped =
    images.carried.every(
      (image) =>
        !!image &&
        Array.isArray(image.refs) &&
        image.refs.every(isRef) &&
        typeof image.entry === 'string' &&
        typeof image.contentType === 'string' &&
        typeof image.bytes === 'number',
    ) && images.leftOut.every(isRef);
  return shaped ? (images as ArchiveImages) : null;
}

/** An image the restore can store again: its checked bytes and the rows that show it. */
export interface UsableImage {
  refs: ArchiveImageRef[];
  contentType: string;
  bytes: Buffer;
  spec: ImageColumn;
}

export interface ImagesOfArchive {
  usable: UsableImage[];
  /** Rows whose image keeps its old link: left out at export, or unusable here. */
  keptLinks: number;
}

/**
 * The ONE check the restore preview and the restore share, so the preview's word is the
 * restore's. An archive is a file anyone can edit: each image is held to the list, to a row the
 * archive really has, and to its REAL bytes in the zip. An image that fails keeps its link; it
 * never refuses the archive (ruling 408).
 */
export function imagesOfArchive(
  archive: { scope: ArchiveScope; images?: unknown },
  data: Partial<ArchiveTables>,
  entries: ReadonlyMap<string, Buffer>,
): ImagesOfArchive {
  const images = imagesOf(archive);
  if (!images) return { usable: [], keptLinks: 0 };
  // Indexed once: a crafted manifest may hold many refs AND many rows, and a scan per ref would
  // hold the event loop for minutes. The preview takes any club admin's upload.
  const rows = rowsById(data);
  const known = (ref: ArchiveImageRef) =>
    !!specOf(ref, archive.scope) && !!rows.get(ref.table)?.has(ref.rowId);

  let keptLinks = images.leftOut.filter(known).length;
  const usable: UsableImage[] = [];
  for (const image of images.carried) {
    const refs = image.refs.filter(known);
    if (refs.length === 0) continue;
    const specs = refs.map((ref) => specOf(ref, archive.scope)!);
    const bytes = entries.get(image.entry);
    const fits =
      ENTRY.test(image.entry) &&
      !!bytes &&
      bytes.length === image.bytes &&
      EXTENSIONS[image.contentType] === image.entry.split('.').pop() &&
      specs.every((spec) => spec.mimeTypes.has(image.contentType)) &&
      specs.every((spec) => bytes.length <= spec.maxBytes);
    if (fits) usable.push({ refs, contentType: image.contentType, bytes: bytes!, spec: specs[0]! });
    else keptLinks += refs.length;
  }
  return { usable, keptLinks };
}

/** The restored id of an archived row, from the restore's id maps. */
export type NewIdOf = (table: ImageTable, id: string) => string | undefined;

type RowsById = Map<string, Map<string, ArchiveRow>>;

/** The rows of the image tables by their id, built once per check or restore. */
function rowsById(data: Partial<ArchiveTables>): RowsById {
  const index: RowsById = new Map();
  for (const table of IMAGE_TABLES) {
    const byId = new Map<string, ArchiveRow>();
    for (const row of imageRowsOf(data, table)) {
      if (typeof row['id'] === 'string') byId.set(row['id'], row);
    }
    index.set(table, byId);
  }
  return index;
}

/** The row an image ref names: by its archive id, or the new id a root row was rewritten to. */
function rowOf(rows: RowsById, ref: ArchiveImageRef, newIdOf: NewIdOf): ArchiveRow | undefined {
  const byId = rows.get(ref.table);
  const newId = newIdOf(ref.table, ref.rowId);
  return byId?.get(ref.rowId) ?? (newId === undefined ? undefined : byId?.get(newId));
}

/** The copy's own folder for an image, named by the FIRST row that shows it. */
function folderOf(rows: RowsById, ref: ArchiveImageRef, newIdOf: NewIdOf): string | undefined {
  if (ref.table === 'themes') {
    const eventId = rowOf(rows, ref, newIdOf)?.['event_id'];
    const restored = typeof eventId === 'string' ? newIdOf('events', eventId) : undefined;
    return restored && `events/${restored}`;
  }
  const restored = newIdOf(ref.table, ref.rowId);
  return restored && `${ref.table}/${restored}`;
}

/**
 * Stores each usable image again in the copy's own folder, under a name made here, and points
 * every row that shows it at the new file. Runs after the restore's id maps are complete and
 * before any row is written. An image storage refuses keeps its old link (ruling 408) and is
 * counted. With no image, no storage call is made at all.
 */
export async function restoreArchiveImages(
  storage: Storage,
  data: ArchiveTables,
  newIdOf: NewIdOf,
  usable: readonly UsableImage[],
): Promise<number> {
  let kept = 0;
  const readyBuckets = new Set<string>();
  const rows = rowsById(data);
  for (const [index, image] of usable.entries()) {
    const first = image.refs[0]!;
    const folder = folderOf(rows, first, newIdOf);
    const { spec } = image;
    const path = `${folder}/${spec.kind}-${Date.now()}-${index + 1}.${EXTENSIONS[image.contentType]}`;
    try {
      if (!folder) throw new Error(`no restored row for ${first.table} ${first.rowId}`);
      if (!readyBuckets.has(spec.bucket)) {
        await ensurePublicBucket(storage, spec.bucket, spec.bucketMaxBytes, spec.mimeTypes);
        readyBuckets.add(spec.bucket);
      }
      const { error } = await storage
        .from(spec.bucket)
        .upload(path, image.bytes, { contentType: image.contentType, upsert: false });
      if (error) throw new Error(error.message);
    } catch (err) {
      kept += image.refs.length;
      const where = folder ? path : `${first.table} ${first.rowId}`;
      logger.warn(`Archive image kept its old link: ${where} (${(err as Error).message})`);
      continue;
    }
    const url = storage.from(spec.bucket).getPublicUrl(path).data.publicUrl;
    for (const ref of image.refs) {
      const row = rowOf(rows, ref, newIdOf);
      if (row) row[ref.column] = url;
    }
  }
  return kept;
}
