import { describe, expect, it, vi } from 'vitest';
import {
  PHOTO_LINK_TTL_S,
  photoLinkSigningDate,
  photoStoreOf,
  type PhotoBucketConfig,
} from './photo-bucket';

/**
 * A signed link to one image (design, "Storage and deletion"): 15 minutes, its expiry rounded
 * down to 5 minutes so the same URL is handed out for 5 minutes and the browser can cache it.
 */

const FR_PAR: PhotoBucketConfig = {
  accessKeyId: 'AK',
  secretAccessKey: 'SK',
  bucket: 'myclash-photos',
  region: 'fr-par',
  endpoint: 'https://s3.fr-par.scw.cloud',
};
const KEY =
  'events/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/preview.jpg';
const at = (iso: string) => new Date(iso);
const noSend = { send: () => Promise.reject(new Error('no bucket call expected')) } as never;

describe('photoLinkSigningDate', () => {
  it('floors to the 5-minute mark', () => {
    expect(photoLinkSigningDate(at('2026-11-05T12:04:59.999Z')).toISOString()).toBe(
      '2026-11-05T12:00:00.000Z',
    );
    expect(photoLinkSigningDate(at('2026-11-05T12:05:00.000Z')).toISOString()).toBe(
      '2026-11-05T12:05:00.000Z',
    );
  });
});

describe('PhotoStore.link', () => {
  it('signs the key for 900 s from the floored time', async () => {
    const presign = vi.fn(async () => 'https://signed.example/x');
    const store = photoStoreOf({ kind: 'on', config: FR_PAR }, noSend, undefined, presign)!;

    await expect(store.link(KEY, at('2026-11-05T12:03:00Z'))).resolves.toBe(
      'https://signed.example/x',
    );
    expect(PHOTO_LINK_TTL_S).toBe(900);
    expect(presign).toHaveBeenCalledWith(KEY, at('2026-11-05T12:00:00Z'), 900);
  });

  it('the real signer: one URL per 5-minute window, never expiring sooner than 10 minutes', async () => {
    // Presigning is local: no request leaves the process, so no bucket is needed.
    const store = photoStoreOf({ kind: 'on', config: FR_PAR }, noSend)!;

    const early = await store.link(KEY, at('2026-11-05T12:01:00Z'));
    const late = await store.link(KEY, at('2026-11-05T12:04:59Z'));
    const next = await store.link(KEY, at('2026-11-05T12:06:00Z'));

    expect(late).toBe(early);
    expect(next).not.toBe(early);
    const url = new URL(early);
    expect(url.pathname.endsWith(`/${KEY}`)).toBe(true);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-Date')).toBe('20261105T120000Z');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get('x-id')).toBe('GetObject');
  });
});
