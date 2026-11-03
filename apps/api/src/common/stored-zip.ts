/**
 * Minimal STORED (uncompressed) zip writer.
 *
 * Extracted from ArchiveService so the HEMA Ratings submission bundle can
 * reuse it without importing a 1400-line service. Deliberately dependency-free:
 * a zip with method 0 entries is spec-legal and every unzip implementation
 * reads it, so bundling a compression library buys nothing for the small
 * CSV/JSON payloads we ship.
 *
 * Entries are written in insertion order; the output is byte-deterministic for
 * a given input, which is what makes it testable.
 */

export function createStoredZip(files: Record<string, string | Buffer>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const contentBuffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    const crc = crc32(contentBuffer);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(contentBuffer.length, 18);
    local.writeUInt32LE(contentBuffer.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, contentBuffer);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(contentBuffer.length, 20);
    central.writeUInt32LE(contentBuffer.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + contentBuffer.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

/** One entry of a stored zip, by its name and its content length in bytes. */
export interface StoredZipEntrySize {
  name: string;
  bytes: number;
}

/**
 * The exact length `createStoredZip` gives these entries, without building the zip: a 30-byte
 * local header and a 46-byte central record per entry, each followed by the name, plus the
 * 22-byte end record.
 */
export function storedZipBytes(entries: readonly StoredZipEntrySize[]): number {
  let total = 22;
  for (const entry of entries) {
    total += 30 + 46 + 2 * Buffer.byteLength(entry.name, 'utf8') + entry.bytes;
  }
  return total;
}

/**
 * The entries of a zip, by name, read by walking its local headers. Each content is a view into
 * `buffer` (no copy). The walk stops at the first non-entry header (the central directory); an
 * entry that claims to end past the buffer means a cut or crafted file, and is refused.
 */
export function readStoredZip(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + buffer.readUInt16LE(offset + 28);
    const dataEnd = dataStart + size;
    if (dataEnd > buffer.length) throw new StoredZipError('A zip entry ends past the file.');
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');
    entries.set(name, buffer.subarray(dataStart, dataEnd));
    offset = dataEnd;
  }
  return entries;
}

/** A zip the reader cannot walk. */
export class StoredZipError extends Error {}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});
