import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import {
  headPhotoBucket,
  photoBucketClientConfig,
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
