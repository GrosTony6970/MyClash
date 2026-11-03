import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { createStoredZip } from '../../common/stored-zip';
import { ARCHIVE_DATA_MAX_BYTES, readArchiveFile } from './archive-file';

const DATA = { manifest: 'myclash.archive.v1', name: 'Fête' };

function refusal(read: () => unknown): unknown {
  try {
    read();
  } catch (err) {
    return err;
  }
  throw new Error('read did not refuse');
}

/** A JSON text of exactly `bytes` bytes. */
function jsonOf(bytes: number): string {
  const head = '{"pad":"';
  return `${head}${'x'.repeat(bytes - head.length - 2)}"}`;
}

describe('readArchiveFile', () => {
  it('reads a JSON file, with leading whitespace', () => {
    expect(readArchiveFile(Buffer.from(`\n  ${JSON.stringify(DATA)}`))).toEqual({
      parsed: DATA,
      entries: new Map(),
    });
  });

  it('reads a JSON file saved with a byte-order mark', () => {
    const file = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(JSON.stringify(DATA)),
    ]);
    expect(readArchiveFile(file).parsed).toEqual(DATA);
  });

  it('reads the manifest of a zip and hands back its other entries', () => {
    const image = Buffer.from([1, 2, 3]);
    const { parsed, entries } = readArchiveFile(
      createStoredZip({ 'manifest.json': JSON.stringify(DATA), 'images/1.png': image }),
    );
    expect(parsed).toEqual(DATA);
    expect(entries.get('images/1.png')).toEqual(image);
  });

  it('takes data of exactly 25 MB', () => {
    expect(readArchiveFile(Buffer.from(jsonOf(ARCHIVE_DATA_MAX_BYTES))).parsed).toHaveProperty(
      'pad',
    );
  });

  it.each([
    ['a JSON file', (text: string) => Buffer.from(text)],
    ['the manifest of a zip', (text: string) => createStoredZip({ 'manifest.json': text })],
  ])('refuses %s over 25 MB with its own code (ruling 409)', (_label, file) => {
    const err = refusal(() => readArchiveFile(file(jsonOf(ARCHIVE_DATA_MAX_BYTES + 1))));
    expect(err).toBeInstanceOf(PayloadTooLargeException);
    expect((err as PayloadTooLargeException).getResponse()).toEqual({
      message: "This archive's data is over the 25 MB limit.",
      code: 'archive_data_too_large',
      maxBytes: ARCHIVE_DATA_MAX_BYTES,
    });
  });

  it.each([
    ['a zip with no manifest', createStoredZip({ 'other.json': '{}' })],
    ['a cut zip', createStoredZip({ 'manifest.json': JSON.stringify(DATA) }).subarray(0, 40)],
    ['text that is neither', Buffer.from('hello')],
    ['JSON that does not parse', Buffer.from('{"a":')],
  ])('refuses %s as an unsupported format', (_label, file) => {
    const err = refusal(() => readArchiveFile(file));
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toBe('Unsupported archive format.');
  });
});
