import { crc32 } from 'node:zlib';

/**
 * Minimal STORED (uncompressed) zip writer: one owner of the zip records, two ways out.
 *
 * `createStoredZip` builds a small zip in memory. Extracted from ArchiveService so the HEMA
 * Ratings submission bundle can reuse it without importing a 1400-line service. Deliberately
 * dependency-free: a zip with method 0 entries is spec-legal and every unzip implementation reads
 * it, so bundling a compression library buys nothing for the small CSV/JSON payloads we ship.
 *
 * `zipStream` writes the same records as chunks, entry by entry, for a zip too big to hold: the
 * Event photos download (design Goal 10, ruling 467). Past 4 GiB of offsets or 65,534 entries it
 * adds the Zip64 records; under both it writes nothing a plain zip reader has not seen.
 *
 * Entries are written in insertion order; the output is byte-deterministic for a given input,
 * which is what makes it testable. Every entry must be under 4 GiB: a local header carries no
 * Zip64 field (an Event photo is at most 12 MiB).
 */

const ALL16 = 0xffff;
const ALL32 = 0xffffffff;
/** Version 2.0 reads a plain stored entry; 4.5 is the first that reads Zip64. */
const PLAIN = 20;
const ZIP64 = 45;

/** One entry of a streamed zip. */
export interface ZipStreamEntry {
  name: string;
  bytes: Buffer;
  /** The CRC32 of `bytes`, when the caller has already checked it; computed otherwise. */
  crc32?: number;
  /** The wall time to stamp on the entry (its DOS date and time), or none. */
  modifiedAt: { day: string; hhmm: string } | null;
}

interface EntryRecord {
  name: Buffer;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

export function createStoredZip(files: Record<string, string | Buffer>): Buffer {
  const parts: Buffer[] = [];
  const records: EntryRecord[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    const record = recordOf({ name, bytes, modifiedAt: null }, offset);
    const header = localHeader(record);
    parts.push(header, bytes);
    records.push(record);
    offset += header.length + bytes.length;
  }
  const central = Buffer.concat(records.map(centralRecord));
  return Buffer.concat([...parts, central, endRecords(records.length, offset, central.length)]);
}

/**
 * The zip of `entries`, as chunks: each entry's header, then its bytes as given (never copied),
 * then the central directory and the end records. The next entry is pulled only when the reader
 * asks for the next chunk, so a slow reader slows the source.
 */
export async function* zipStream(entries: AsyncIterable<ZipStreamEntry>): AsyncGenerator<Buffer> {
  const records: EntryRecord[] = [];
  let offset = 0;
  for await (const entry of entries) {
    const record = recordOf(entry, offset);
    const header = localHeader(record);
    yield header;
    yield entry.bytes;
    records.push(record);
    offset += header.length + entry.bytes.length;
  }
  const central = Buffer.concat(records.map(centralRecord));
  yield central;
  yield endRecords(records.length, offset, central.length);
}

function recordOf(entry: ZipStreamEntry, offset: number): EntryRecord {
  return {
    name: Buffer.from(entry.name, 'utf8'),
    crc: entry.crc32 ?? crc32(entry.bytes),
    size: entry.bytes.length,
    offset,
    ...dosStamp(entry.modifiedAt),
  };
}

/** A wall time as MS-DOS writes it; none is 0/0, as the in-memory zips have always had. */
function dosStamp(at: ZipStreamEntry['modifiedAt']): { time: number; date: number } {
  if (!at) return { time: 0, date: 0 };
  const [year, month, day] = at.day.split('-').map(Number) as [number, number, number];
  const [hour, minute] = at.hhmm.split(':').map(Number) as [number, number];
  return { time: (hour << 11) | (minute << 5), date: ((year - 1980) << 9) | (month << 5) | day };
}

function localHeader(record: EntryRecord): Buffer {
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(PLAIN, 4);
  local.writeUInt16LE(record.time, 10);
  local.writeUInt16LE(record.date, 12);
  local.writeUInt32LE(record.crc, 14);
  local.writeUInt32LE(record.size, 18);
  local.writeUInt32LE(record.size, 22);
  local.writeUInt16LE(record.name.length, 26);
  return Buffer.concat([local, record.name]);
}

/** The entry's directory record; an offset past 32 bits goes in a Zip64 extra field. */
function centralRecord(record: EntryRecord): Buffer {
  const zip64 = record.offset >= ALL32;
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(zip64 ? ZIP64 : PLAIN, 4);
  central.writeUInt16LE(zip64 ? ZIP64 : PLAIN, 6);
  central.writeUInt16LE(record.time, 12);
  central.writeUInt16LE(record.date, 14);
  central.writeUInt32LE(record.crc, 16);
  central.writeUInt32LE(record.size, 20);
  central.writeUInt32LE(record.size, 24);
  central.writeUInt16LE(record.name.length, 28);
  central.writeUInt32LE(zip64 ? ALL32 : record.offset, 42);
  if (!zip64) return Buffer.concat([central, record.name]);
  const extra = Buffer.alloc(12);
  extra.writeUInt16LE(1, 0);
  extra.writeUInt16LE(8, 2);
  extra.writeBigUInt64LE(BigInt(record.offset), 4);
  central.writeUInt16LE(extra.length, 30);
  return Buffer.concat([central, record.name, extra]);
}

/**
 * The end of the zip: the classic end record, preceded by the Zip64 end record and its locator
 * when the count, the directory's size or its offset does not fit the classic fields.
 */
function endRecords(count: number, centralOffset: number, centralSize: number): Buffer {
  const zip64 = count >= ALL16 || centralOffset >= ALL32 || centralSize >= ALL32;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Math.min(count, ALL16), 8);
  end.writeUInt16LE(Math.min(count, ALL16), 10);
  end.writeUInt32LE(Math.min(centralSize, ALL32), 12);
  end.writeUInt32LE(Math.min(centralOffset, ALL32), 16);
  if (!zip64) return end;

  const zip64End = Buffer.alloc(56);
  zip64End.writeUInt32LE(0x06064b50, 0);
  zip64End.writeBigUInt64LE(44n, 4);
  zip64End.writeUInt16LE(ZIP64, 12);
  zip64End.writeUInt16LE(ZIP64, 14);
  zip64End.writeBigUInt64LE(BigInt(count), 24);
  zip64End.writeBigUInt64LE(BigInt(count), 32);
  zip64End.writeBigUInt64LE(BigInt(centralSize), 40);
  zip64End.writeBigUInt64LE(BigInt(centralOffset), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(BigInt(centralOffset + centralSize), 8);
  locator.writeUInt32LE(1, 16);
  return Buffer.concat([zip64End, locator, end]);
}

/** One entry of a stored zip, by its name and its content length in bytes. */
export interface StoredZipEntrySize {
  name: string;
  bytes: number;
}

/**
 * The exact length `createStoredZip` gives these entries, without building the zip: a 30-byte
 * local header and a 46-byte central record per entry, each followed by the name, plus the
 * 22-byte end record. Under the Zip64 limits only (65,534 entries, 4 GiB of offsets): past them
 * the zip also holds the Zip64 records, which this does not count.
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
