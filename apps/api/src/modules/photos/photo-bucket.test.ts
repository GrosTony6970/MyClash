import { createServer } from 'node:http';
import {
  createServer as createNetServer,
  type AddressInfo,
  type Server,
  type Socket,
} from 'node:net';
import {
  DeleteObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  boundedCall,
  headPhotoBucket,
  photoKeyParts,
  photoObjectKeys,
  photoBucketClientConfig,
  photoStoreOf,
  readPhotoBucketSetting,
  type PhotoBucketConfig,
} from './photo-bucket';

const env = (values: Record<string, string>) => (key: string) => values[key];

const FULL = {
  PHOTO_BUCKET_ACCESS_KEY: 'AK',
  PHOTO_BUCKET_SECRET_KEY: 'SK',
  PHOTO_BUCKET_NAME: 'myclash-photos',
};

const FR_PAR: PhotoBucketConfig = {
  accessKeyId: 'AK',
  secretAccessKey: 'SK',
  bucket: 'myclash-photos',
  region: 'fr-par',
  endpoint: 'https://s3.fr-par.scw.cloud',
};

describe('readPhotoBucketSetting', () => {
  it('is off when none of the three keys is set', () => {
    expect(readPhotoBucketSetting(env({}))).toEqual({ kind: 'off' });
  });

  it('never borrows the backup bucket or its keys', () => {
    const backupOnly = env({
      BACKUP_SCW_ACCESS_KEY: 'BAK',
      BACKUP_SCW_SECRET_KEY: 'BSK',
      BACKUP_SCW_BUCKET: 'myclash-backups',
      BACKUP_SCW_REGION: 'nl-ams',
      BACKUP_SCW_ENDPOINT: 'https://s3.nl-ams.scw.cloud',
    });
    expect(readPhotoBucketSetting(backupOnly)).toEqual({ kind: 'off' });

    const both = env({
      ...FULL,
      BACKUP_SCW_REGION: 'nl-ams',
      BACKUP_SCW_ENDPOINT: 'https://s3.nl-ams.scw.cloud',
    });
    expect(readPhotoBucketSetting(both)).toMatchObject({
      kind: 'on',
      config: { region: 'fr-par', endpoint: 'https://s3.fr-par.scw.cloud' },
    });
  });

  it('reads an empty value as unset (compose passes ${X:-})', () => {
    const blank = env({
      PHOTO_BUCKET_ACCESS_KEY: '',
      PHOTO_BUCKET_SECRET_KEY: '  ',
      PHOTO_BUCKET_NAME: '',
    });
    expect(readPhotoBucketSetting(blank)).toEqual({ kind: 'off' });
  });

  it('names every missing key when only some are set', () => {
    expect(readPhotoBucketSetting(env({ PHOTO_BUCKET_NAME: 'myclash-photos' }))).toEqual({
      kind: 'partial',
      missing: ['PHOTO_BUCKET_ACCESS_KEY', 'PHOTO_BUCKET_SECRET_KEY'],
    });
  });

  it('defaults region and endpoint to Scaleway fr-par', () => {
    expect(readPhotoBucketSetting(env(FULL))).toEqual({ kind: 'on', config: FR_PAR });
  });

  it('keeps an explicit region and endpoint', () => {
    const setting = readPhotoBucketSetting(
      env({
        ...FULL,
        PHOTO_BUCKET_REGION: 'nl-ams',
        PHOTO_BUCKET_ENDPOINT: 'https://s3.nl-ams.scw.cloud',
      }),
    );
    expect(setting).toEqual({
      kind: 'on',
      config: { ...FR_PAR, region: 'nl-ams', endpoint: 'https://s3.nl-ams.scw.cloud' },
    });
  });
});

describe('photoBucketClientConfig', () => {
  it('sets the timeouts and the WHEN_REQUIRED checksums', () => {
    expect(photoBucketClientConfig(FR_PAR)).toMatchObject({
      region: 'fr-par',
      endpoint: 'https://s3.fr-par.scw.cloud',
      credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      requestHandler: {
        connectionTimeout: 5_000,
        requestTimeout: 30_000,
        throwOnRequestTimeout: true,
      },
    });
  });
});

describe('the client built from photoBucketClientConfig', () => {
  it('gives up on a bucket that accepts the connection and never answers', async () => {
    // The SDK only WARNS on its request timeout unless told to throw; a stalled write would
    // then hang for ever. A server that takes the request and never replies proves it throws.
    const server = createServer(() => {});
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const base = photoBucketClientConfig({ ...FR_PAR, endpoint: `http://127.0.0.1:${port}` });
    const client = new S3Client({
      ...base,
      maxAttempts: 1,
      forcePathStyle: true,
      requestHandler: { ...(base.requestHandler as object), requestTimeout: 200 },
    });
    const started = Date.now();
    try {
      await expect(
        client.send(new HeadBucketCommand({ Bucket: 'myclash-photos' })),
      ).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      client.destroy();
      server.closeAllConnections();
      server.close();
    }
  });
});

describe('photoStoreOf', () => {
  it('is nothing when the bucket is not configured, so the upload can say so', () => {
    expect(photoStoreOf({ kind: 'off' })).toBeNull();
    expect(photoStoreOf({ kind: 'partial', missing: ['PHOTO_BUCKET_NAME'] })).toBeNull();
  });

  it('writes a JPEG under its key in the configured bucket, with a bounded wait', async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = photoStoreOf({ kind: 'on', config: FR_PAR }, { send } as never)!;
    const bytes = Buffer.from('jpeg bytes');

    await store.put('events/e/p/original.jpg', bytes);

    const [command, options] = send.mock.calls[0] as [
      PutObjectCommand,
      { abortSignal: AbortSignal },
    ];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({
      Bucket: 'myclash-photos',
      Key: 'events/e/p/original.jpg',
      Body: bytes,
      ContentType: 'image/jpeg',
    });
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('deletes by key in the configured bucket, with a bounded wait', async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = photoStoreOf({ kind: 'on', config: FR_PAR }, { send } as never)!;

    await store.remove('events/e/p/preview.jpg');

    const [command, options] = send.mock.calls[0] as [
      DeleteObjectCommand,
      { abortSignal: AbortSignal },
    ];
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input).toEqual({ Bucket: 'myclash-photos', Key: 'events/e/p/preview.jpg' });
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('lists one page of keys under a prefix, with a bounded wait', async () => {
    const send = vi.fn().mockResolvedValue({
      Contents: [
        { Key: 'events/e/p/original.jpg', LastModified: new Date('2026-06-01T10:00:00Z') },
        { Key: 'events/e/p/preview.jpg' },
        { LastModified: new Date('2026-06-01T10:00:00Z') },
      ],
      NextContinuationToken: 'page-2',
    });
    const store = photoStoreOf({ kind: 'on', config: FR_PAR }, { send } as never)!;

    const page = await store.list('events/', 'page-1');

    const [command, options] = send.mock.calls[0] as [
      ListObjectsV2Command,
      { abortSignal: AbortSignal },
    ];
    expect(command).toBeInstanceOf(ListObjectsV2Command);
    expect(command.input).toEqual({
      Bucket: 'myclash-photos',
      Prefix: 'events/',
      ContinuationToken: 'page-1',
      MaxKeys: 1000,
    });
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
    // An entry with no key or no date cannot be judged, so it is not listed.
    expect(page).toEqual({
      objects: [{ key: 'events/e/p/original.jpg', lastModified: new Date('2026-06-01T10:00:00Z') }],
      next: 'page-2',
      undated: 2,
    });
  });

  it('says the listing is complete when no continuation token comes back', async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = photoStoreOf({ kind: 'on', config: FR_PAR }, { send } as never)!;
    expect(await store.list('events/')).toEqual({ objects: [], next: undefined, undated: 0 });
  });

  it('counts a delete of a key already gone as done, and a missing bucket as a failure', async () => {
    const sdkError = (name: string) =>
      Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 404 } });
    const gone = photoStoreOf({ kind: 'on', config: FR_PAR }, {
      send: vi.fn().mockRejectedValue(sdkError('NoSuchKey')),
    } as never)!;
    await expect(gone.remove('events/e/p/original.jpg')).resolves.toBeUndefined();

    const noBucket = photoStoreOf({ kind: 'on', config: FR_PAR }, {
      send: vi.fn().mockRejectedValue(sdkError('NoSuchBucket')),
    } as never)!;
    await expect(noBucket.remove('events/e/p/original.jpg')).rejects.toThrow(
      'Photo bucket myclash-photos does not exist (HTTP 404)',
    );
  });

  it('re-tells a refused write by its status', async () => {
    const send = vi.fn().mockRejectedValue(
      Object.assign(new Error('UnknownError'), {
        name: '403',
        $metadata: { httpStatusCode: 403 },
      }),
    );
    const store = photoStoreOf({ kind: 'on', config: FR_PAR }, { send } as never)!;
    await expect(store.put('k', Buffer.from('x'))).rejects.toThrow('HTTP 403');
  });
});

describe('the photo key shape', () => {
  const EVENT = '11111111-1111-4111-8111-111111111111';
  const PHOTO = 'AAAAAAAA-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  it('names both images of a photo, and reads them back', () => {
    const keys = photoObjectKeys(EVENT, PHOTO);
    expect(keys).toEqual({
      original_key: `events/${EVENT}/${PHOTO}/original.jpg`,
      preview_key: `events/${EVENT}/${PHOTO}/preview.jpg`,
    });
    for (const key of Object.values(keys)) {
      expect(photoKeyParts(key)).toEqual({ eventId: EVENT, photoId: PHOTO.toLowerCase() });
    }
  });

  it('reads nothing from a key in any other shape, a hyphenless id included', () => {
    expect(photoKeyParts('events/x/stray.txt')).toBeNull();
    expect(photoKeyParts(`events/${EVENT}/${PHOTO}/thumb.jpg`)).toBeNull();
    expect(photoKeyParts(`events/${'a'.repeat(36)}/${PHOTO}/original.jpg`)).toBeNull();
    expect(photoKeyParts(`backups/${EVENT}/${PHOTO}/original.jpg`)).toBeNull();
  });
});

describe('boundedCall', () => {
  it('gives up at its bound and aborts the call, even when the call ignores the signal', async () => {
    let aborted = false;
    const started = Date.now();
    await expect(
      boundedCall(
        (signal) => {
          signal.addEventListener('abort', () => (aborted = true));
          return new Promise(() => {});
        },
        30,
        'delete',
      ),
    ).rejects.toThrow('Photo bucket did not answer within 30 ms (delete)');
    expect(aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('passes the answer and the error of a call that settles in time', async () => {
    await expect(boundedCall(async () => 'ok', 1_000, 'list')).resolves.toBe('ok');
    await expect(
      boundedCall(async () => Promise.reject(new Error('HTTP 500')), 1_000, 'list'),
    ).rejects.toThrow('HTTP 500');
  });
});

describe('the store over a bucket that never answers', () => {
  // The SDK's own retries outlast its connection timeout, and its request timeout is 30 s: only
  // the store's bound keeps the drain and the sweep from waiting on a silent bucket.
  let server: Server;
  let sockets: Socket[];
  beforeEach(async () => {
    sockets = [];
    server = createNetServer((socket) => void sockets.push(socket));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });
  afterEach(() => {
    for (const socket of sockets) socket.destroy();
    server.close();
  });

  it.each(['remove', 'put', 'list'] as const)('%s gives up within its bound', async (call) => {
    const { port } = server.address() as AddressInfo;
    const config = { ...FR_PAR, endpoint: `http://127.0.0.1:${port}` };
    const client = new S3Client({ ...photoBucketClientConfig(config), forcePathStyle: true });
    const store = photoStoreOf({ kind: 'on', config }, client, {
      writeMs: 300,
      deleteMs: 300,
      listMs: 300,
    })!;
    const started = Date.now();
    try {
      const pending =
        call === 'remove'
          ? store.remove('events/e/p/original.jpg')
          : call === 'put'
            ? store.put('events/e/p/original.jpg', Buffer.from('x'))
            : store.list('events/');
      await expect(pending).rejects.toThrow('Photo bucket did not answer within 300 ms');
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      client.destroy();
    }
  });
});

describe('headPhotoBucket', () => {
  it('asks for the configured bucket with HeadBucket and passes the signal', async () => {
    const send = vi.fn().mockResolvedValue({});
    const signal = new AbortController().signal;

    await headPhotoBucket({ send } as never)(FR_PAR, signal);

    const [command, options] = send.mock.calls[0] as [HeadBucketCommand, unknown];
    expect(command).toBeInstanceOf(HeadBucketCommand);
    expect(command.input).toEqual({ Bucket: 'myclash-photos' });
    expect(options).toEqual({ abortSignal: signal });
  });

  // A HEAD answer has no body, so the SDK names the error by its status and says only
  // "UnknownError". The operator must still tell a wrong key from a missing bucket.
  const sdkError = (name: string, status: number) =>
    Object.assign(new Error('UnknownError'), { name, $metadata: { httpStatusCode: status } });

  it('says the key was refused on a 403', async () => {
    const send = vi.fn().mockRejectedValue(sdkError('403', 403));
    await expect(
      headPhotoBucket({ send } as never)(FR_PAR, new AbortController().signal),
    ).rejects.toThrow(
      'Photo bucket refused the key (HTTP 403): check its access to myclash-photos',
    );
  });

  it('says the bucket does not exist on a 404', async () => {
    const send = vi.fn().mockRejectedValue(sdkError('NotFound', 404));
    await expect(
      headPhotoBucket({ send } as never)(FR_PAR, new AbortController().signal),
    ).rejects.toThrow('Photo bucket myclash-photos does not exist (HTTP 404)');
  });

  it('names any other HTTP refusal by its status', async () => {
    const send = vi.fn().mockRejectedValue(sdkError('500', 500));
    await expect(
      headPhotoBucket({ send } as never)(FR_PAR, new AbortController().signal),
    ).rejects.toThrow('Photo bucket answered HTTP 500 (500)');
  });

  it('passes an error with no HTTP answer through unchanged', async () => {
    const send = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:9'));
    await expect(
      headPhotoBucket({ send } as never)(FR_PAR, new AbortController().signal),
    ).rejects.toThrow('connect ECONNREFUSED 127.0.0.1:9');
  });
});
