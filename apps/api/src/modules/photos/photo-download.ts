import { crc32 } from 'node:zlib';
import { csvFile, type CsvFormat } from '@myclash/types';
import { utcToZonedParts } from '@myclash/time';
import type { ZipStreamEntry } from '../../common/stored-zip';
import type { PhotoStore } from './photo-bucket';
import { photoTag } from './photo-tag';

/**
 * The organiser's "Download all" (design Goal 10): the entries of the zip, from the photo rows
 * already read. Each original is read whole (at most 12 MiB) and checked against the size and CRC
 * stored at upload BEFORE its entry is handed on, so a photo gone from the bucket, or changed,
 * is left out cleanly and named in the log (ruling 468). `photos.csv` comes last and lists
 * exactly the photos in the zip.
 */

/** A photo row as the download reads it. */
export interface DownloadRow {
  id: string;
  status: string;
  uploader_name: string | null;
  caption: string | null;
  created_at: string;
  original_key: string;
  byte_size: number;
  crc32: number;
  tournament: { name: string } | null;
  workshop: { title: string } | null;
}

export const PHOTOS_CSV = 'photos.csv';

const CSV_HEADER = ['file', 'name', 'caption', 'tag', 'time', 'status'];

/** When the photo was sent, on the Event's clock. */
function sentAt(row: DownloadRow, zone: string): { day: string; hhmm: string } {
  const parts = utcToZonedParts(row.created_at, zone);
  if (!parts) throw new Error(`Photo ${row.id}: unreadable time ${row.created_at}`);
  return parts;
}

/** `2026-11-01_14-03_3f2a9c1e.jpg`: sorts by time; never the sender's text (anonymous input). */
export function photoFileName(row: DownloadRow, zone: string): string {
  const { day, hhmm } = sentAt(row, zone);
  return `${day}_${hhmm.replace(':', '-')}_${row.id.slice(0, 8)}.jpg`;
}

/** One row per photo in the zip, through the one owner of a downloaded CSV's shape. */
export function photosCsv(rows: readonly DownloadRow[], zone: string, format: CsvFormat): Buffer {
  const lines = rows.map((row) => {
    const { day, hhmm } = sentAt(row, zone);
    return [
      photoFileName(row, zone),
      row.uploader_name ?? '',
      row.caption ?? '',
      photoTag(row)?.name ?? '',
      `${day} ${hhmm}`,
      row.status,
    ];
  });
  return Buffer.from(csvFile([CSV_HEADER, ...lines], format), 'utf8');
}

/** Why a read original cannot go in the zip, or null when it can. */
function refusal(row: DownloadRow, bytes: Buffer | null): string | null {
  if (!bytes) return 'its image is not in the bucket';
  if (bytes.length !== row.byte_size || crc32(bytes) !== row.crc32) {
    return 'its image differs from the size or CRC stored at upload';
  }
  return null;
}

/** A read that may fail while nobody awaits it: the failure is kept for the await, never loose. */
function readAhead(store: PhotoStore, row: DownloadRow): Promise<Buffer | null> {
  const read = store.get(row.original_key);
  read.catch(() => {});
  return read;
}

/**
 * The zip's entries: one original read ahead of the reader, never more. `stop` is the
 * download's own end (its stream closed): from then on no read starts, even when the reader's
 * `return()` waits behind a read under way.
 */
export async function* photoEntries(
  rows: readonly DownloadRow[],
  store: PhotoStore,
  zone: string,
  format: CsvFormat,
  warn: (message: string) => void,
  stop: AbortSignal,
): AsyncGenerator<ZipStreamEntry> {
  const included: DownloadRow[] = [];
  let ahead = rows[0] ? readAhead(store, rows[0]) : null;
  for (const [index, row] of rows.entries()) {
    const bytes = await ahead!;
    const next = rows[index + 1];
    ahead = next && !stop.aborted ? readAhead(store, next) : null;
    const why = refusal(row, bytes);
    if (why) {
      warn(`Photo ${row.id} left out of the download: ${why}`);
    } else {
      included.push(row);
      const modifiedAt = sentAt(row, zone);
      yield { name: photoFileName(row, zone), bytes: bytes!, crc32: row.crc32, modifiedAt };
    }
    if (stop.aborted) return;
  }
  yield { name: PHOTOS_CSV, bytes: photosCsv(included, zone, format), modifiedAt: null };
}
