import {
  PHOTO_BUCKET_PROBE_TIMEOUT_MS,
  type PhotoBucketProbe,
  type PhotoBucketSetting,
} from '../../photos/photo-bucket';

export type PhotoStorageReading =
  { configured: false } | { configured: true; bucket: string; latencyMs: number };

/**
 * Whether the photo bucket answers. The probe is raced against a timer: when the timer fires it
 * aborts the probe and gives up, so the health card answers even if the SDK ignores the abort.
 */
export async function collectPhotoStorage(
  setting: PhotoBucketSetting,
  probe: PhotoBucketProbe,
  { timeoutMs = PHOTO_BUCKET_PROBE_TIMEOUT_MS, now = Date.now } = {},
): Promise<PhotoStorageReading> {
  if (setting.kind === 'off') return { configured: false };
  if (setting.kind === 'partial') {
    throw new Error(`Photo bucket is partly configured: missing ${setting.missing.join(', ')}`);
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gaveUp = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Photo bucket did not answer within ${timeoutMs} ms`));
    }, timeoutMs);
  });

  const started = now();
  try {
    await Promise.race([probe(setting.config, controller.signal), gaveUp]);
  } finally {
    clearTimeout(timer);
  }
  return { configured: true, bucket: setting.config.bucket, latencyMs: now() - started };
}
