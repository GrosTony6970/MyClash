import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createStoredZip, zipStream, type ZipStreamEntry } from './stored-zip';
import { readZip } from './testing/zip-reader';

async function* from(entries: ZipStreamEntry[]): AsyncGenerator<ZipStreamEntry> {
  yield* entries;
}

async function collect(chunks: AsyncIterable<Buffer>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of chunks) parts.push(chunk);
  return Buffer.concat(parts);
}

const entry = (name: string, bytes: Buffer | string): ZipStreamEntry => ({
  name,
  bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'utf8'),
  modifiedAt: null,
});

const ZIP64_END = Buffer.from([0x50, 0x4b, 0x06, 0x06]);
const ZIP64_LOCATOR = Buffer.from([0x50, 0x4b, 0x06, 0x07]);

describe('zipStream', () => {
  const files = [
    entry('a.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
    entry('empty.txt', ''),
    entry('photos.csv', 'file,name\r\n'),
  ];

  it('writes entries a reader reads back, local headers matching the directory', async () => {
    const zip = readZip(await collect(zipStream(from(files))));
    expect(zip.entries.map((e) => e.name)).toEqual(['a.jpg', 'empty.txt', 'photos.csv']);
    expect(zip.entries.map((e) => e.data?.toString('latin1'))).toEqual(
      files.map((f) => f.bytes.toString('latin1')),
    );
    expect(zip.entries.map((e) => e.crc)).toEqual(files.map((f) => crc32(f.bytes)));
  });

  it('writes what createStoredZip writes, byte for byte, when no entry has a time', async () => {
    const streamed = await collect(zipStream(from(files)));
    const built = createStoredZip(Object.fromEntries(files.map((f) => [f.name, f.bytes])));
    expect(streamed.equals(built)).toBe(true);
  });

  it('writes no Zip64 record under the limits', async () => {
    const bytes = await collect(zipStream(from(files)));
    expect(bytes.includes(ZIP64_END)).toBe(false);
    expect(bytes.includes(ZIP64_LOCATOR)).toBe(false);
    const zip = readZip(bytes);
    expect(zip.zip64EndAt).toBeNull();
    expect(zip.entries.every((e) => e.extraLength === 0 && e.versionNeeded === 20)).toBe(true);
  });

  it('writes the time each entry was sent as its zip date and time', async () => {
    const dated = { ...files[0]!, modifiedAt: { day: '2026-11-01', hhmm: '14:03' } };
    const [read] = readZip(await collect(zipStream(from([dated])))).entries;
    expect(read!.dosDate).toBe(((2026 - 1980) << 9) | (11 << 5) | 1);
    expect(read!.dosTime).toBe((14 << 11) | (3 << 5));
  });

  it('uses the CRC the caller already checked instead of computing it again', async () => {
    const given = { ...files[0]!, crc32: 0x12345678 };
    const bytes = await collect(zipStream(from([given])));
    // The reader recomputes the CRC from the data, so it refuses the planted one: proof it was used.
    expect(() => readZip(bytes)).toThrow('CRC mismatch');
  });

  it('pulls the next entry only when its reader asks for more', async () => {
    let pulled = 0;
    async function* counted(): AsyncGenerator<ZipStreamEntry> {
      for (const f of files) {
        pulled += 1;
        yield f;
      }
    }
    const chunks = zipStream(counted());
    await chunks.next();
    expect(pulled).toBe(1);
    await chunks.return(undefined);
  });

  it('writes Zip64 counts past 65,534 entries', async () => {
    const many = Array.from({ length: 70_000 }, (_, i) => entry(`${i}`.padStart(5, '0'), ''));
    const bytes = await collect(zipStream(from(many)));
    const zip = readZip(bytes);
    expect(zip.end.count).toBe(0xffff);
    expect(zip.count).toBe(70_000);
    expect(zip.entries).toHaveLength(70_000);
    expect(zip.end.centralOffset).toBe(zip.centralOffset);
    expect(zip.entries.some((e) => e.zip64Offset)).toBe(false);
  });

  it('writes Zip64 offsets past 4 GiB, without keeping the zip', async () => {
    const photo = Buffer.alloc(12 * 1024 * 1024);
    const crc = crc32(photo);
    const many = Array.from({ length: 350 }, (_, i) => ({
      name: `p/${String(i).padStart(4, '0')}.jpg`,
      bytes: photo,
      crc32: crc,
      modifiedAt: null,
    }));
    let total = 0;
    const keep = 4 * 1024 * 1024;
    let tail: Buffer = Buffer.alloc(0);
    for await (const chunk of zipStream(from(many))) {
      total += chunk.length;
      // Only the zip's last 4 MiB is kept (the end of the last photo, the directory, the end
      // records), contiguous, so the reader can walk it by offset.
      tail =
        chunk.length >= keep ? chunk.subarray(-keep) : Buffer.concat([tail, chunk]).subarray(-keep);
    }
    const perEntry = 30 + 10 + photo.length;
    const centralOffset = 350 * perEntry;
    expect(centralOffset).toBeGreaterThan(0xffffffff);
    const zip = readZip(tail, total - tail.length);

    expect(zip.end.centralOffset).toBe(0xffffffff);
    expect(zip.centralOffset).toBe(centralOffset);
    expect(zip.centralOffset).toBe(total - zip.centralSize - 98);
    expect(zip.zip64EndAt).toBe(centralOffset + zip.centralSize);
    expect(zip.entries.map((e) => e.offset)).toEqual(many.map((_, i) => i * perEntry));
    for (const e of zip.entries) {
      expect(e.zip64Offset).toBe(e.offset >= 0xffffffff);
      expect(e.versionNeeded).toBe(e.zip64Offset ? 45 : 20);
    }
    expect(zip.entries.filter((e) => e.zip64Offset).length).toBeGreaterThan(0);
  }, 60_000);
});
