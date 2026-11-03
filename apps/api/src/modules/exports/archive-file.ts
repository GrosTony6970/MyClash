import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import type { UploadLimit } from '../../common/read-upload';
import { readStoredZip, StoredZipError } from '../../common/stored-zip';

/**
 * An archive to restore (operator rulings 206 and 404). The zip may be 50 MB: its images are only
 * copied. Its data, `manifest.json` (or a `.json` file), stays at 25 MB: parsing it takes several
 * times its size, up to ~24× for a crafted file.
 */
export const ARCHIVE_UPLOAD: UploadLimit = {
  maxBytes: 50 * 1024 * 1024,
  tooLarge: 'Archive upload exceeds the 50 MB size limit.',
};
export const ARCHIVE_DATA_MAX_BYTES = 25 * 1024 * 1024;

/** The code of the 413 an archive whose data is over 25 MB gets (ruling 409). */
export const ARCHIVE_DATA_TOO_LARGE_CODE = 'archive_data_too_large';

const UNSUPPORTED = 'Unsupported archive format.';
const BOM = [0xef, 0xbb, 0xbf] as const;

/** What an uploaded archive file holds: its parsed data, and the zip's entries (none for JSON). */
export interface ArchiveFile {
  parsed: unknown;
  entries: Map<string, Buffer>;
}

/**
 * Reads an uploaded archive: a JSON file, or a zip whose `manifest.json` is the data. Only the
 * data is decoded, and only after its size is checked; the rest of a zip stays bytes.
 */
export function readArchiveFile(buffer: Buffer): ArchiveFile {
  const start = firstContentByte(buffer);
  if (buffer[start] === 0x7b /* { */) {
    return { parsed: parseData(buffer.subarray(start)), entries: new Map() };
  }
  let entries: Map<string, Buffer>;
  try {
    entries = readStoredZip(buffer);
  } catch (err) {
    if (err instanceof StoredZipError) throw new BadRequestException(UNSUPPORTED);
    throw err;
  }
  const manifest = entries.get('manifest.json');
  if (!manifest) throw new BadRequestException(UNSUPPORTED);
  return { parsed: parseData(manifest), entries };
}

/** Past a UTF-8 byte-order mark (a JSON saved by Notepad) and leading whitespace. */
function firstContentByte(buffer: Buffer): number {
  let index = BOM.every((byte, i) => buffer[i] === byte) ? BOM.length : 0;
  while (index < buffer.length && isWhitespace(buffer[index]!)) index += 1;
  return index;
}

function isWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

function parseData(bytes: Buffer): unknown {
  if (bytes.length > ARCHIVE_DATA_MAX_BYTES) {
    throw new PayloadTooLargeException({
      message: "This archive's data is over the 25 MB limit.",
      code: ARCHIVE_DATA_TOO_LARGE_CODE,
      maxBytes: ARCHIVE_DATA_MAX_BYTES,
    });
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new BadRequestException(UNSUPPORTED);
  }
}
