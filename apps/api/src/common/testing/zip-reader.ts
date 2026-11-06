import { crc32 } from 'node:zlib';

/**
 * A zip reader for tests, written apart from the writer (`stored-zip.ts`) so a shared mistake
 * cannot pass both. It starts where an unzip tool starts: the end record, then the Zip64 locator
 * and end record when present, then the central directory; then, for each entry whose local
 * header is inside `buffer`, it checks that header and the entry's CRC.
 *
 * `base` is the zip offset of `buffer[0]`: a test that keeps only the tail of a large zip reads
 * the directory from that tail.
 */

export interface ReadEntry {
  name: string;
  crc: number;
  size: number;
  offset: number;
  versionNeeded: number;
  extraLength: number;
  /** The Zip64 extra field held the offset. */
  zip64Offset: boolean;
  dosTime: number;
  dosDate: number;
  /** Present when the local header and the data are inside the buffer. */
  data?: Buffer;
}

export interface ReadZip {
  entries: ReadEntry[];
  count: number;
  centralOffset: number;
  centralSize: number;
  /** The classic end record's fields, as written. */
  end: { count: number; centralSize: number; centralOffset: number };
  /** The Zip64 end record's offset, when the zip has one. */
  zip64EndAt: number | null;
}

const ALL32 = 0xffffffff;

export function readZip(buffer: Buffer, base = 0): ReadZip {
  const endAt = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0) throw new Error('no end record');
  const end = {
    count: buffer.readUInt16LE(endAt + 10),
    centralSize: buffer.readUInt32LE(endAt + 12),
    centralOffset: buffer.readUInt32LE(endAt + 16),
  };
  let { count, centralSize, centralOffset } = end;
  let zip64EndAt: number | null = null;
  const locatorAt = endAt - 20;
  if (locatorAt >= 0 && buffer.readUInt32LE(locatorAt) === 0x07064b50) {
    zip64EndAt = Number(buffer.readBigUInt64LE(locatorAt + 8));
    const at = zip64EndAt - base;
    if (buffer.readUInt32LE(at) !== 0x06064b50) throw new Error('locator misses the Zip64 end');
    if (Number(buffer.readBigUInt64LE(at + 4)) !== 44) throw new Error('Zip64 end size');
    count = Number(buffer.readBigUInt64LE(at + 32));
    centralSize = Number(buffer.readBigUInt64LE(at + 40));
    centralOffset = Number(buffer.readBigUInt64LE(at + 48));
  }
  const entries = readCentral(buffer, base, centralOffset, count);
  for (const entry of entries) readLocal(buffer, base, entry);
  return { entries, count, centralOffset, centralSize, end, zip64EndAt };
}

function readCentral(buffer: Buffer, base: number, from: number, count: number): ReadEntry[] {
  const entries: ReadEntry[] = [];
  let at = from - base;
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error(`central record ${i} missing`);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    let offset = buffer.readUInt32LE(at + 42);
    let zip64Offset = false;
    if (offset === ALL32) {
      const extra = at + 46 + nameLength;
      if (buffer.readUInt16LE(extra) !== 1 || buffer.readUInt16LE(extra + 2) !== 8) {
        throw new Error(`central record ${i}: no Zip64 offset`);
      }
      offset = Number(buffer.readBigUInt64LE(extra + 4));
      zip64Offset = true;
    }
    entries.push({
      name: buffer.subarray(at + 46, at + 46 + nameLength).toString('utf8'),
      crc: buffer.readUInt32LE(at + 16),
      size: buffer.readUInt32LE(at + 24),
      offset,
      versionNeeded: buffer.readUInt16LE(at + 6),
      extraLength,
      zip64Offset,
      dosTime: buffer.readUInt16LE(at + 12),
      dosDate: buffer.readUInt16LE(at + 14),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readLocal(buffer: Buffer, base: number, entry: ReadEntry): void {
  const at = entry.offset - base;
  if (at < 0) return;
  if (buffer.readUInt32LE(at) !== 0x04034b50) throw new Error(`${entry.name}: no local header`);
  const same =
    buffer.readUInt32LE(at + 14) === entry.crc &&
    buffer.readUInt32LE(at + 18) === entry.size &&
    buffer.readUInt32LE(at + 22) === entry.size &&
    buffer.readUInt16LE(at + 10) === entry.dosTime &&
    buffer.readUInt16LE(at + 12) === entry.dosDate;
  if (!same) throw new Error(`${entry.name}: local header differs from the central record`);
  const start = at + 30 + buffer.readUInt16LE(at + 26) + buffer.readUInt16LE(at + 28);
  const data = buffer.subarray(start, start + entry.size);
  if (data.length !== entry.size) return;
  if (crc32(data) !== entry.crc) throw new Error(`${entry.name}: CRC mismatch`);
  entry.data = data;
}
