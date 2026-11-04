import { PHOTO_HEIF_BRANDS, PHOTO_MAX_BYTES } from '@myclash/types';

/**
 * What the phone page checks before sending a photo, so a phone on venue wifi does not send
 * 12 MB only to be told no. The API checks every one of these again and stays the authority
 * (`apps/api/src/modules/photos/jpeg-strip.ts`).
 */

export type PhotoKind = 'jpeg' | 'heic' | 'other';
export type LocalRefusal = 'file_too_large' | 'photo_heic' | 'photo_not_jpeg';

/** How many leading bytes `photoKindOf` reads. */
export const PHOTO_HEAD_BYTES = 12;

/** The same list the API reads (`jpeg-strip.ts` `sniffPhoto`). */
const HEIF_BRANDS = new Set<string>(PHOTO_HEIF_BRANDS);

const ascii = (head: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...head.subarray(from, to));

/** The kind of photo its first `PHOTO_HEAD_BYTES` bytes say. */
export function photoKindOf(head: Uint8Array): PhotoKind {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (head.length >= 12 && ascii(head, 4, 8) === 'ftyp' && HEIF_BRANDS.has(ascii(head, 8, 12))) {
    return 'heic';
  }
  return 'other';
}

/** Why this photo cannot be sent, or `null` when the API should be asked. */
export function localRefusal(size: number, head: Uint8Array): LocalRefusal | null {
  if (size > PHOTO_MAX_BYTES) return 'file_too_large';
  const kind = photoKindOf(head);
  if (kind === 'heic') return 'photo_heic';
  return kind === 'jpeg' ? null : 'photo_not_jpeg';
}
