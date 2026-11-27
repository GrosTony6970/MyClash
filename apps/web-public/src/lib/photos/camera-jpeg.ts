import { PHOTO_MAX_BYTES } from '@myclash/types';
import type { LocalRefusal } from './photo-checks';

/**
 * A photo in the shape a phone camera writes, made on the phone before it is sent (ruling 1004).
 *
 * The API keeps only that shape (`apps/api/src/modules/photos/jpeg-strip.ts`, the authority): one
 * baseline or extended-sequential 8-bit frame of 1 or 3 components, coded as ONE scan of every
 * component over the full spectrum. Anything else can take far more memory to decode than its file
 * size says, so the API refuses it. A picture saved from a website or exported by an app is often
 * progressive, and so is a photo the Google Photos picker downloads from the cloud.
 *
 * A camera JPEG is sent as it is, byte for byte. Any other JPEG is drawn on a canvas and saved
 * again as a camera-shaped JPEG: it is re-compressed, the one case where the original is not kept.
 */

export type PreparedPhoto = { ok: true; file: File } | { ok: false; refusal: LocalRefusal };

/** iOS Safari draws nothing on a canvas over 4096 × 4096; well under the API's 64 MP. */
const CANVAS_MAX_PIXELS = 4096 * 4096;
const QUALITY = 0.92;

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const DQT = 0xdb;
const DHT = 0xc4;
const DRI = 0xdd;

const isFrameMarker = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== DHT && marker !== 0xc8 && marker !== 0xcc;

/** The segments the API reads past: tables, the restart interval, every APPn and comment. */
const isPassed = (marker: number) =>
  marker === DQT ||
  marker === DHT ||
  marker === DRI ||
  (marker >= 0xe0 && marker <= 0xef) ||
  marker === 0xfe;

/** The frame's component ids, or `null` when the API would not take this frame. */
function frameIds(marker: number, payload: Uint8Array): number[] | null {
  if (marker !== 0xc0 && marker !== 0xc1) return null;
  const components = payload[5] ?? 0;
  if (payload[0] !== 8 || (components !== 1 && components !== 3)) return null;
  if (payload.length !== 6 + 3 * components) return null;
  const height = (payload[1]! << 8) | payload[2]!;
  const width = (payload[3]! << 8) | payload[4]!;
  if (width === 0 || height === 0) return null;
  return Array.from({ length: components }, (_, i) => payload[6 + 3 * i]!);
}

/** Every frame component, in frame order, over the full spectrum, no refinement. */
function isFullScan(payload: Uint8Array, ids: readonly number[]): boolean {
  const components = payload[0] ?? 0;
  if (payload.length !== 4 + 2 * components) return false;
  const scanIds = Array.from({ length: components }, (_, i) => payload[1 + 2 * i]!);
  const [start, end, approximation] = payload.subarray(1 + 2 * components);
  return scanIds.join(',') === ids.join(',') && start === 0 && end === 63 && approximation === 0;
}

/** Where the coded data from `from` ends (the next real marker), or -1. */
function endOfScan(bytes: Uint8Array, from: number): number {
  for (let at = bytes.indexOf(0xff, from); at >= 0; at = bytes.indexOf(0xff, at + 1)) {
    const next = bytes[at + 1];
    if (next === undefined) return -1;
    // FF00 is a stuffed byte, FFD0-FFD7 a restart marker, FFFF fill: all part of the data.
    if (next !== 0x00 && next !== 0xff && (next < 0xd0 || next > 0xd7)) return at;
  }
  return -1;
}

interface Walk {
  ids: number[] | null;
  scans: number;
}

/** The offset past this segment, or -1 when the API would not take it. */
function stepPast(bytes: Uint8Array, start: number, marker: number, walk: Walk): number {
  if (start + 4 > bytes.length) return -1;
  const end = start + 2 + ((bytes[start + 2]! << 8) | bytes[start + 3]!);
  if (end < start + 4 || end > bytes.length) return -1;
  const payload = bytes.subarray(start + 4, end);
  if (isFrameMarker(marker)) {
    if (walk.ids) return -1;
    walk.ids = frameIds(marker, payload);
    return walk.ids ? end : -1;
  }
  if (marker === SOS) {
    if (!walk.ids || walk.scans > 0 || !isFullScan(payload, walk.ids)) return -1;
    walk.scans += 1;
    return endOfScan(bytes, end);
  }
  return isPassed(marker) ? end : -1;
}

/** Whether the API takes these bytes as they are: the same walk as `stripJpeg`, up to its EOI. */
export function isCameraJpeg(bytes: Uint8Array): boolean {
  if (bytes[0] !== 0xff || bytes[1] !== SOI) return false;
  const walk: Walk = { ids: null, scans: 0 };
  let at = 2;
  while (at >= 0) {
    if (bytes[at] !== 0xff) return false;
    while (bytes[at + 1] === 0xff) at += 1;
    const marker = bytes[at + 1];
    if (marker === undefined) return false;
    if (marker === EOI) return walk.scans === 1;
    at = stepPast(bytes, at, marker, walk);
  }
  return false;
}

/** The picture drawn again, no larger than a canvas can hold, as a JPEG; `null` if it cannot be. */
async function redrawn(bitmap: ImageBitmap): Promise<Blob | null> {
  const scale = Math.min(1, Math.sqrt(CANVAS_MAX_PIXELS / (bitmap.width * bitmap.height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(bitmap.width * scale));
  canvas.height = Math.max(1, Math.floor(bitmap.height * scale));
  try {
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', QUALITY));
  } finally {
    // A phone keeps a canvas's memory until it is sized down, not when it is dropped.
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * The file to send for this photo. A file the phone can no longer read is sent as it is: the send
 * then fails as a lost connection does, with Retry, as it did before this step existed.
 */
export async function toCameraJpeg(file: File): Promise<PreparedPhoto> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: true, file };
  }
  if (isCameraJpeg(bytes)) return { ok: true, file };

  let bitmap: ImageBitmap;
  try {
    // The Exif orientation is applied here, so the new JPEG is upright and needs none.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return { ok: false, refusal: 'photo_corrupt' };
  }
  try {
    const blob = await redrawn(bitmap);
    if (!blob) return { ok: false, refusal: 'photo_corrupt' };
    if (blob.size > PHOTO_MAX_BYTES) return { ok: false, refusal: 'file_too_large' };
    // A browser that saves progressive would be refused by the API all the same: say so here.
    if (!isCameraJpeg(new Uint8Array(await blob.arrayBuffer()))) {
      return { ok: false, refusal: 'photo_unsupported_jpeg' };
    }
    return { ok: true, file: new File([blob], file.name, { type: 'image/jpeg' }) };
  } finally {
    bitmap.close();
  }
}
