import { HeadBucketCommand, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';

/**
 * The photo bucket's settings and its S3 client. One owner: nothing else reads a `PHOTO_BUCKET_*`
 * key.
 *
 * The photo bucket is its own Scaleway bucket with its own key pair (operator, 2026-11-04). It is
 * never the backup bucket, and this module never reads a `BACKUP_SCW_*` key, not even as a
 * fallback: a leaked photo key must not reach the backups, and the reverse.
 *
 * The keys are optional for now: until the operator creates the bucket, the setting is `off` and
 * runtime health says "Not configured". The photo upload slice makes them required in
 * `scripts/ensure-prod-env.mjs`.
 */

export const PHOTO_BUCKET_KEYS = [
  'PHOTO_BUCKET_ACCESS_KEY',
  'PHOTO_BUCKET_SECRET_KEY',
  'PHOTO_BUCKET_NAME',
] as const;
export type PhotoBucketKey = (typeof PHOTO_BUCKET_KEYS)[number];

export interface PhotoBucketConfig {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
  endpoint: string;
}

export type PhotoBucketSetting =
  | { kind: 'off' }
  | { kind: 'partial'; missing: PhotoBucketKey[] }
  | { kind: 'on'; config: PhotoBucketConfig };

/** Scaleway fr-par: the same values as the backup block of `.env.example`, but not read from it. */
const DEFAULT_REGION = 'fr-par';
const DEFAULT_ENDPOINT = 'https://s3.fr-par.scw.cloud';

/** No call to the bucket may wait forever (design, "When the bucket is slow or down"). */
export const PHOTO_BUCKET_CONNECT_TIMEOUT_MS = 5_000;
/** The socket budget: one object written in 30 s. Shorter calls pass their own abort signal. */
export const PHOTO_BUCKET_REQUEST_TIMEOUT_MS = 30_000;
/** The health probe is a list-class call: 10 s. */
export const PHOTO_BUCKET_PROBE_TIMEOUT_MS = 10_000;

export type PhotoBucketProbe = (config: PhotoBucketConfig, signal: AbortSignal) => Promise<void>;

export function readPhotoBucketSetting(
  get: (key: string) => string | undefined,
): PhotoBucketSetting {
  const read = (key: string) => get(key)?.trim() || undefined;
  const [accessKeyId, secretAccessKey, bucket] = PHOTO_BUCKET_KEYS.map(read);
  const missing = PHOTO_BUCKET_KEYS.filter((key) => !read(key));

  if (missing.length === PHOTO_BUCKET_KEYS.length) return { kind: 'off' };
  if (!accessKeyId || !secretAccessKey || !bucket) return { kind: 'partial', missing };
  return {
    kind: 'on',
    config: {
      accessKeyId,
      secretAccessKey,
      bucket,
      region: read('PHOTO_BUCKET_REGION') ?? DEFAULT_REGION,
      endpoint: read('PHOTO_BUCKET_ENDPOINT') ?? DEFAULT_ENDPOINT,
    },
  };
}

export function photoBucketClientConfig(config: PhotoBucketConfig): S3ClientConfig {
  return {
    region: config.region,
    endpoint: config.endpoint,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // An S3-compatible store may refuse the SDK's default CRC32 checksums.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    requestHandler: {
      connectionTimeout: PHOTO_BUCKET_CONNECT_TIMEOUT_MS,
      requestTimeout: PHOTO_BUCKET_REQUEST_TIMEOUT_MS,
      // Without it the SDK only logs a warning at the request timeout and keeps waiting.
      throwOnRequestTimeout: true,
    },
  };
}

export function createPhotoBucketClient(config: PhotoBucketConfig): S3Client {
  return new S3Client(photoBucketClientConfig(config));
}

/**
 * Asks whether the bucket exists and the key may reach it. Resolves on any 2xx.
 *
 * A HEAD answer has no body, so the SDK's error says only "UnknownError". The refusal is
 * re-told by its status, so the operator can tell a wrong key from a missing bucket.
 */
export function headPhotoBucket(client: Pick<S3Client, 'send'>): PhotoBucketProbe {
  return async (config, signal) => {
    try {
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }), { abortSignal: signal });
    } catch (err) {
      throw refusalOf(err, config.bucket);
    }
  };
}

function refusalOf(err: unknown, bucket: string): unknown {
  const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  if (status === undefined) return err;
  if (status === 403) {
    return new Error(`Photo bucket refused the key (HTTP 403): check its access to ${bucket}`);
  }
  if (status === 404) return new Error(`Photo bucket ${bucket} does not exist (HTTP 404)`);
  return new Error(`Photo bucket answered HTTP ${status} (${(err as Error).name})`);
}
