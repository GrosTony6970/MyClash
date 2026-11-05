import {
  boundedCall,
  PHOTO_BUCKET_PROBE_TIMEOUT_MS,
  type PhotoBucketProbe,
  type PhotoBucketSetting,
} from '../../photos/photo-bucket';

export type PhotoStorageReading =
  { configured: false } | { configured: true; bucket: string; latencyMs: number };

/**
 * Whether the photo bucket answers. The probe is bounded by `boundedCall`: at the timeout it is
 * aborted and given up on, so the health card answers even if the SDK ignores the abort.
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

  const started = now();
  await boundedCall((signal) => probe(setting.config, signal), timeoutMs, 'probe');
  return { configured: true, bucket: setting.config.bucket, latencyMs: now() - started };
}
