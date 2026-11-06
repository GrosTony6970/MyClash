import {
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadBucketCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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
/** One object written: 30 s. One object deleted: 10 s. */
export const PHOTO_BUCKET_WRITE_TIMEOUT_MS = 30_000;
export const PHOTO_BUCKET_DELETE_TIMEOUT_MS = 10_000;
/** One original read, its body included: 30 s (design: a download that stalls 30 s is cut). */
export const PHOTO_BUCKET_READ_TIMEOUT_MS = 30_000;

/** The DI token of the photo store; null when the bucket is not configured. */
export const PHOTO_STORE = Symbol('PHOTO_STORE');

/** A key in the bucket, with the time it was written: the orphan sweep keeps a young one. */
export interface PhotoObject {
  key: string;
  lastModified: Date;
}

/** One page of a listing. `undated` counts entries with no key or date: they cannot be judged. */
export interface PhotoPage {
  objects: PhotoObject[];
  next?: string;
  undated: number;
}

/** Where photo images are written, listed and removed. Every call has its own bounded wait. */
export interface PhotoStore {
  put(key: string, bytes: Buffer): Promise<void>;
  /** The bytes stored under `key`, read whole within one bound; null when the key is gone. */
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
  /** One page of keys under `prefix`, at most 1,000. `next` is set while more remain. */
  list(prefix: string, next?: string): Promise<PhotoPage>;
  /**
   * A signed GET link to one image, valid `PHOTO_LINK_TTL_S` from the 5-minute mark before
   * `now`. Signing is local (no bucket call), so it needs no bound and works with the bucket down.
   */
  link(key: string, now: Date): Promise<string>;
}

/** A signed link lasts 15 minutes from its signing time (design, "Storage and deletion"). */
export const PHOTO_LINK_TTL_S = 900;
const PHOTO_LINK_STEP_MS = 5 * 60_000;

/**
 * A link's signing time: `now` rounded down to the 5-minute mark, so every call in one window
 * signs the same URL and the browser caches the image. A link handed out lives 10-15 minutes.
 */
export function photoLinkSigningDate(now: Date): Date {
  return new Date(Math.floor(now.getTime() / PHOTO_LINK_STEP_MS) * PHOTO_LINK_STEP_MS);
}

/** Signs a GET of `key` at `signingDate`, valid `expiresIn` seconds. */
export type PhotoLinkPresign = (
  key: string,
  signingDate: Date,
  expiresIn: number,
) => Promise<string>;

/** The real signer, over its own client: signing needs the full client, not only `send`. */
export function photoLinkSigner(config: PhotoBucketConfig): PhotoLinkPresign {
  const s3 = createPhotoBucketClient(config);
  return (key, signingDate, expiresIn) =>
    getSignedUrl(s3, new GetObjectCommand({ Bucket: config.bucket, Key: key }), {
      expiresIn,
      signingDate,
    });
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PHOTO_KEY = new RegExp(`^events/(${UUID})/(${UUID})/(?:original|preview)\\.jpg$`, 'i');

/** Where a photo's two images live in the bucket. The one owner of the key shape. */
export function photoObjectKeys(
  eventId: string,
  photoId: string,
): { original_key: string; preview_key: string } {
  return {
    original_key: `events/${eventId}/${photoId}/original.jpg`,
    preview_key: `events/${eventId}/${photoId}/preview.jpg`,
  };
}

/** The Event and photo a key names, lower-cased, or null for a key in any other shape. */
export function photoKeyParts(key: string): { eventId: string; photoId: string } | null {
  const hit = PHOTO_KEY.exec(key);
  return hit ? { eventId: hit[1]!.toLowerCase(), photoId: hit[2]!.toLowerCase() } : null;
}

/** The store's waits; the defaults are the design's, tests pass shorter ones. */
export interface PhotoStoreTimeouts {
  writeMs: number;
  deleteMs: number;
  listMs: number;
  readMs: number;
}

const STORE_TIMEOUTS: PhotoStoreTimeouts = {
  writeMs: PHOTO_BUCKET_WRITE_TIMEOUT_MS,
  deleteMs: PHOTO_BUCKET_DELETE_TIMEOUT_MS,
  listMs: PHOTO_BUCKET_PROBE_TIMEOUT_MS,
  readMs: PHOTO_BUCKET_READ_TIMEOUT_MS,
};

/**
 * Runs `call` with an abort signal and gives up at `ms`, whether or not the call honours the
 * signal: the SDK's retries outlast its connection timeout, so a signal alone is not a bound.
 */
export async function boundedCall<T>(
  call: (signal: AbortSignal) => Promise<T>,
  ms: number,
  what: string,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gaveUp = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Photo bucket did not answer within ${ms} ms (${what})`));
    }, ms);
  });
  try {
    return await Promise.race([call(controller.signal), gaveUp]);
  } finally {
    clearTimeout(timer);
  }
}

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

/**
 * The photo store over the configured bucket, or null when it is not configured: the upload then
 * answers "Photos are unavailable" rather than failing a write it could never make.
 */
export function photoStoreOf(
  setting: PhotoBucketSetting,
  client?: Pick<S3Client, 'send'>,
  timeouts: PhotoStoreTimeouts = STORE_TIMEOUTS,
  presign?: PhotoLinkPresign,
): PhotoStore | null {
  if (setting.kind !== 'on') return null;
  const { bucket } = setting.config;
  const s3 = client ?? createPhotoBucketClient(setting.config);
  const send = sender(s3, bucket);
  const sign = presign ?? photoLinkSigner(setting.config);
  return {
    link: (key, now) => sign(key, photoLinkSigningDate(now), PHOTO_LINK_TTL_S),
    get: originalReader(s3, bucket, timeouts.readMs),
    put: async (key, bytes) => {
      const body = { Bucket: bucket, Key: key, Body: bytes, ContentType: 'image/jpeg' };
      await send(new PutObjectCommand(body), timeouts.writeMs, 'write');
    },
    remove: async (key) => {
      try {
        await send(
          new DeleteObjectCommand({ Bucket: bucket, Key: key }),
          timeouts.deleteMs,
          'delete',
        );
      } catch (err) {
        // A key already gone is the goal reached; a missing BUCKET is still a failure.
        if (!(err instanceof MissingKey)) throw err;
      }
    },
    list: async (prefix, next) => {
      const input = { Bucket: bucket, Prefix: prefix, ContinuationToken: next, MaxKeys: 1000 };
      const page = await send<ListObjectsV2CommandOutput>(
        new ListObjectsV2Command(input),
        timeouts.listMs,
        'list',
      );
      const contents = page.Contents ?? [];
      const objects = objectsOf(contents);
      return {
        objects,
        next: page.NextContinuationToken,
        undated: contents.length - objects.length,
      };
    },
  };
}

/** One bucket call, bounded, its refusal re-told by status. */
function sender(s3: Pick<S3Client, 'send'>, bucket: string) {
  return async <T>(
    command: PutObjectCommand | DeleteObjectCommand | ListObjectsV2Command,
    timeoutMs: number,
    what: string,
  ): Promise<T> => {
    try {
      return await boundedCall(
        (signal) => s3.send(command as never, { abortSignal: signal }) as Promise<T>,
        timeoutMs,
        what,
      );
    } catch (err) {
      throw refusalOf(err, bucket);
    }
  };
}

/**
 * Reads one object whole: the answer AND its body inside one bound, because `sender` bounds only
 * the answer and a body can stall after it. When the bound gives up, the body is closed so its
 * socket does not stay open.
 */
function originalReader(s3: Pick<S3Client, 'send'>, bucket: string, ms: number) {
  return async (key: string): Promise<Buffer | null> => {
    let body: { destroy?: () => void } | undefined;
    try {
      return await boundedCall(
        async (signal) => {
          const answer = (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
            abortSignal: signal,
          })) as GetObjectCommandOutput;
          if (!answer.Body) throw new Error('Photo bucket sent no body (read)');
          body = answer.Body as { destroy?: () => void };
          const bytes = await answer.Body.transformToByteArray();
          // A view, not a copy: an original is up to 12 MiB.
          return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        },
        ms,
        'read',
      );
    } catch (err) {
      body?.destroy?.();
      const refusal = refusalOf(err, bucket);
      if (refusal instanceof MissingKey) return null;
      throw refusal;
    }
  };
}

/** The listed keys with their dates. An entry with no key or no date cannot be judged: skipped. */
function objectsOf(contents: NonNullable<ListObjectsV2CommandOutput['Contents']>): PhotoObject[] {
  return contents.flatMap((entry) =>
    entry.Key && entry.LastModified ? [{ key: entry.Key, lastModified: entry.LastModified }] : [],
  );
}

/** A 404 that names the KEY, not the bucket: S3 may answer it to a delete of a key already gone. */
class MissingKey extends Error {}

function refusalOf(err: unknown, bucket: string): unknown {
  const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  if (status === 404 && (err as Error).name === 'NoSuchKey') {
    return new MissingKey(`Photo bucket has no such key (HTTP 404)`);
  }
  if (status === undefined) return err;
  if (status === 403) {
    return new Error(`Photo bucket refused the key (HTTP 403): check its access to ${bucket}`);
  }
  if (status === 404) return new Error(`Photo bucket ${bucket} does not exist (HTTP 404)`);
  return new Error(`Photo bucket answered HTTP ${status} (${(err as Error).name})`);
}
