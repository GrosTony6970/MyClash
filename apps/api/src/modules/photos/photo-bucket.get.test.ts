import { GetObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { PHOTO_BUCKET_READ_TIMEOUT_MS, photoStoreOf, type PhotoBucketConfig } from './photo-bucket';

const FR_PAR: PhotoBucketConfig = {
  accessKeyId: 'AK',
  secretAccessKey: 'SK',
  bucket: 'myclash-photos',
  region: 'fr-par',
  endpoint: 'https://s3.fr-par.scw.cloud',
};

const TIMEOUTS = { writeMs: 1_000, deleteMs: 1_000, listMs: 1_000, readMs: 20 };
const storeOver = (send: ReturnType<typeof vi.fn>) =>
  photoStoreOf({ kind: 'on', config: FR_PAR }, { send } as never, TIMEOUTS)!;
const bodyOf = (read: () => Promise<Uint8Array>) => ({
  transformToByteArray: read,
  destroy: vi.fn(),
});
const sdkError = (name: string, status: number) =>
  Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });

describe('the photo store reads one original', () => {
  it('waits 30 s for an original by default (design: a stalled read is cut at 30 s)', () => {
    expect(PHOTO_BUCKET_READ_TIMEOUT_MS).toBe(30_000);
  });

  it('reads the bytes of a key in the configured bucket, with a bounded wait', async () => {
    const send = vi.fn().mockResolvedValue({ Body: bodyOf(async () => Uint8Array.from([1, 2])) });

    const bytes = await storeOver(send).get('events/e/p/original.jpg');

    expect(bytes).toEqual(Buffer.from([1, 2]));
    expect(Buffer.isBuffer(bytes)).toBe(true);
    const [command, options] = send.mock.calls[0] as [
      GetObjectCommand,
      { abortSignal: AbortSignal },
    ];
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toEqual({ Bucket: 'myclash-photos', Key: 'events/e/p/original.jpg' });
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('answers null for a key that is gone', async () => {
    const send = vi.fn().mockRejectedValue(sdkError('NoSuchKey', 404));
    await expect(storeOver(send).get('events/e/p/original.jpg')).resolves.toBeNull();
  });

  it('fails on a missing bucket and on a refused key, by status', async () => {
    await expect(
      storeOver(vi.fn().mockRejectedValue(sdkError('NoSuchBucket', 404))).get('k'),
    ).rejects.toThrow('Photo bucket myclash-photos does not exist (HTTP 404)');
    await expect(
      storeOver(vi.fn().mockRejectedValue(sdkError('AccessDenied', 403))).get('k'),
    ).rejects.toThrow('Photo bucket refused the key (HTTP 403)');
  });

  it('gives up when the body stalls, and closes the body so its socket goes', async () => {
    const body = bodyOf(() => new Promise<Uint8Array>(() => {}));
    const send = vi.fn().mockResolvedValue({ Body: body });

    await expect(storeOver(send).get('k')).rejects.toThrow('did not answer within 20 ms (read)');
    expect(body.destroy).toHaveBeenCalledOnce();
  });

  it('fails when the answer has no body', async () => {
    const send = vi.fn().mockResolvedValue({});
    await expect(storeOver(send).get('k')).rejects.toThrow('Photo bucket sent no body (read)');
  });
});
