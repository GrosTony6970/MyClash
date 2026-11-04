import sharp from 'sharp';
import { MAX_PIXELS } from './jpeg-strip';

/**
 * The light copy of an Event photo that the public feed and the moderation queue show; the
 * original opens on tap. Made by sharp from the STRIPPED bytes, so libvips only ever reads a
 * baseline JPEG our own parser rebuilt (principal-engineer sign-off, 2026-11-04).
 *
 * One libvips thread and no operation cache: the same wall time for a one-shot shrink, with less
 * memory, inside a 1 GB API that also serves everyone else. Baseline JPEGs shrink on load, so a
 * 48 MP photo costs about 13 MB here.
 */
sharp.concurrency(1);
sharp.cache(false);

export const PREVIEW_LONG_SIDE = 1024;

export async function makePreview(stripped: Buffer): Promise<Buffer> {
  return sharp(stripped, { failOn: 'error', limitInputPixels: MAX_PIXELS })
    .autoOrient()
    .resize(PREVIEW_LONG_SIDE, PREVIEW_LONG_SIDE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
}
