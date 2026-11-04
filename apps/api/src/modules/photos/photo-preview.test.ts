import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { stripJpeg } from './jpeg-strip';
import { makePreview, PREVIEW_LONG_SIDE } from './photo-preview';
import { baseJpeg, loadedJpeg } from './testing/synthetic-jpeg';

describe('makePreview', () => {
  it('shrinks a phone-sized photo to a light tile with no metadata', async () => {
    const photo = await sharp({
      create: {
        width: 4032,
        height: 3024,
        channels: 3,
        background: '#808080',
        noise: { type: 'gaussian', mean: 128, sigma: 30 },
      },
    })
      .blur(2)
      .jpeg({ quality: 90 })
      .toBuffer();

    const preview = await makePreview(stripJpeg(photo).bytes);
    const meta = await sharp(preview).metadata();

    expect(Math.max(meta.width!, meta.height!)).toBe(PREVIEW_LONG_SIDE);
    expect(preview.length).toBeLessThan(400 * 1024);
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.iptc).toBeUndefined();
    expect(meta.icc).toBeUndefined();
  }, 20_000);

  it('turns a sideways photo upright', async () => {
    const preview = await makePreview(stripJpeg(await loadedJpeg({ orientation: 6 })).bytes);
    const { data, info } = await sharp(preview).raw().toBuffer({ resolveWithObject: true });

    expect([info.width, info.height]).toEqual([32, 64]);
    const at = (x: number, y: number) => [
      ...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3),
    ];
    const [r, , b] = at(info.width - 4, 4);
    expect(r).toBeGreaterThan(200);
    expect(b).toBeLessThan(60);
    expect(meta(await sharp(preview).metadata())).toBe(1);
  });

  it('never enlarges a small photo', async () => {
    const meta = await sharp(await makePreview(await baseJpeg())).metadata();
    expect([meta.width, meta.height]).toEqual([64, 32]);
  });
});

/** An upright preview carries no orientation, or orientation 1. */
function meta(m: { orientation?: number }): number {
  return m.orientation ?? 1;
}
