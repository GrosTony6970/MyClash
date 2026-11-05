import type { Logger } from '@nestjs/common';
import type { PhotoStore } from './photo-bucket';

/** A photo row's two image keys. */
export interface PhotoKeys {
  id: string;
  preview_key: string;
  original_key: string;
}

/**
 * Both signed links of a photo, or neither: with no bucket, or a signer that fails, the tile shows
 * "image unavailable" (design, "When the bucket is slow or down"). A failure is logged, never
 * thrown. The moderation queue and the public list both sign through here.
 */
export async function photoLinks(
  store: PhotoStore | null,
  row: PhotoKeys,
  now: Date,
  logger: Pick<Logger, 'warn'>,
): Promise<{ previewUrl: string | null; originalUrl: string | null }> {
  if (!store) return { previewUrl: null, originalUrl: null };
  try {
    const [previewUrl, originalUrl] = await Promise.all([
      store.link(row.preview_key, now),
      store.link(row.original_key, now),
    ]);
    return { previewUrl, originalUrl };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn(`Photo ${row.id}: could not sign its links: ${reason}`);
    return { previewUrl: null, originalUrl: null };
  }
}
