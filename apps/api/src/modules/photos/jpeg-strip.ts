/**
 * The kept original of an Event photo: the phone's JPEG with everything hidden taken out, and the
 * picture itself copied byte for byte (operator ruling: the original is kept as sent, no
 * re-compression).
 *
 * A WHITELIST, never a blacklist (design, "The server"). The walk goes forward by segment length
 * and keeps only what draws the picture: quantisation and Huffman tables, the restart interval, a
 * baseline frame header, the one scan, and Adobe's fixed 12-byte colour-transform block. Every
 * APPn (EXIF, GPS, XMP, IPTC, ICC, MPF, JFIF thumbnails) and every comment goes, and so does
 * everything after the first end-of-image marker: secondary images, Motion Photo video, Samsung
 * trailers. Each kept segment is checked against its own structure, so a metadata block renamed to
 * look like a table is refused rather than carried. (A sender can still choose the values inside
 * real tables and the picture: that is their own data, not what a phone hides in a photo.) The
 * orientation is read from the first Exif block and written back as a fresh, minimal one, so the
 * photo stays upright.
 *
 * Only what phone cameras write is accepted: one baseline or extended-sequential 8-bit frame with
 * 1 or 3 components, coded as ONE scan that carries every component over the full spectrum. Decode
 * memory is bounded only then, never by the file size. A progressive JPEG (a 0.5 MB file declaring
 * 48 MP took 290 MB in sharp) and a baseline one split into partial scans (0.75 MB, 8000×8000:
 * 400 MB) both make libjpeg keep every coefficient of the image (measured 2026-11-04), so both are
 * refused.
 */

import { PHOTO_HEIF_BRANDS, type PhotoFileRefusal } from '@myclash/types';

export class PhotoRefusalError extends Error {
  constructor(
    readonly code: PhotoFileRefusal,
    message: string,
  ) {
    super(message);
    this.name = 'PhotoRefusalError';
  }
}

/** Covers the 48 and 50 MP modes of current phones. The preview's decode checks it again. */
export const MAX_PIXELS = 64_000_000;

export type Orientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface StrippedJpeg {
  bytes: Buffer;
  width: number;
  height: number;
  orientation: Orientation;
}

const HEIC_BRANDS = new Set<string>(PHOTO_HEIF_BRANDS);

export function sniffPhoto(bytes: Buffer): 'jpeg' | 'webp' | 'heic' | 'unknown' {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF') {
    return bytes.toString('latin1', 8, 12) === 'WEBP' ? 'webp' : 'unknown';
  }
  if (bytes.length >= 12 && bytes.toString('latin1', 4, 8) === 'ftyp') {
    return HEIC_BRANDS.has(bytes.toString('latin1', 8, 12)) ? 'heic' : 'unknown';
  }
  return 'unknown';
}

const corrupt = (why: string) => new PhotoRefusalError('photo_corrupt', `Damaged JPEG: ${why}.`);
const unsupported = (why: string) =>
  new PhotoRefusalError('photo_unsupported_jpeg', `Unsupported JPEG: ${why}.`);

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const DQT = 0xdb;
const DHT = 0xc4;
const DRI = 0xdd;
const APP1 = 0xe1;
const APP14 = 0xee;

interface Frame {
  width: number;
  height: number;
  /** The component ids, in frame order: the one scan must carry exactly these. */
  ids: number[];
}

interface Walk {
  kept: Buffer[];
  frame?: Frame;
  orientation?: Orientation;
  scans: number;
}

export function stripJpeg(bytes: Buffer): StrippedJpeg {
  refuseOtherFormats(bytes);
  const walk: Walk = { kept: [], scans: 0 };
  let at = 2;

  for (;;) {
    const { marker, start } = markerAt(bytes, at);
    if (marker === EOI) {
      if (walk.scans === 0) throw corrupt('no image data before its end');
      walk.kept.push(bytes.subarray(start, start + 2));
      break;
    }
    if (marker === SOI || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      throw corrupt('a marker out of place');
    }
    const end = segmentEnd(bytes, start);
    const payload = bytes.subarray(start + 4, end);
    if (marker !== SOS) {
      if (keepSegment(walk, marker, payload)) walk.kept.push(bytes.subarray(start, end));
      at = end;
      continue;
    }
    if (!walk.frame) throw corrupt('a scan before its frame header');
    if (walk.scans > 0) throw unsupported('more than one scan');
    checkScanHeader(payload, walk.frame);
    at = endOfScan(bytes, end);
    walk.kept.push(bytes.subarray(start, at));
    walk.scans += 1;
  }

  const orientation = walk.orientation ?? 1;
  const head = orientation === 1 ? [] : [orientationApp1(orientation)];
  return {
    bytes: Buffer.concat([bytes.subarray(0, 2), ...head, ...walk.kept]),
    width: walk.frame!.width,
    height: walk.frame!.height,
    orientation,
  };
}

/** Whether a segment before or between scans is part of the picture. Throws on a bad one. */
function keepSegment(walk: Walk, marker: number, payload: Buffer): boolean {
  if (isFrameMarker(marker)) {
    if (walk.frame) throw corrupt('a second frame header');
    walk.frame = readFrame(marker, payload);
    return true;
  }
  if (marker === DQT || marker === DHT || marker === DRI) {
    checkTable(marker, payload);
    return true;
  }
  if (marker === APP14)
    return payload.length === 12 && payload.toString('latin1', 0, 5) === 'Adobe';
  if (marker === APP1 && walk.orientation === undefined && isExif(payload)) {
    walk.orientation = readOrientation(payload.subarray(6));
    return false;
  }
  if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) return false;
  throw corrupt(`an unexpected segment 0x${marker.toString(16)}`);
}

function refuseOtherFormats(bytes: Buffer): void {
  const kind = sniffPhoto(bytes);
  if (kind === 'heic') {
    throw new PhotoRefusalError('photo_heic', 'HEIC photos are not accepted; send a JPEG.');
  }
  if (kind !== 'jpeg')
    throw new PhotoRefusalError('photo_not_jpeg', 'Only JPEG photos are accepted.');
}

/** The marker at `at`, past any fill bytes (0xFF repeated before a marker is allowed). */
function markerAt(bytes: Buffer, at: number): { marker: number; start: number } {
  let start = at;
  if (bytes[start] !== 0xff) throw corrupt('bytes between segments');
  while (bytes[start + 1] === 0xff) start += 1;
  if (start + 1 >= bytes.length) throw corrupt('no end of image');
  return { marker: bytes[start + 1]!, start };
}

function segmentEnd(bytes: Buffer, start: number): number {
  if (start + 4 > bytes.length) throw corrupt('a segment cut short');
  const length = bytes.readUInt16BE(start + 2);
  const end = start + 2 + length;
  if (length < 2 || end > bytes.length) throw corrupt('a segment running past the end');
  return end;
}

/** The offset of the marker that ends the coded data starting at `from`. */
function endOfScan(bytes: Buffer, from: number): number {
  let at = from;
  for (;;) {
    const ff = bytes.indexOf(0xff, at);
    if (ff < 0 || ff + 1 >= bytes.length) throw corrupt('no end of image');
    const next = bytes[ff + 1]!;
    // FF00 is a stuffed byte, FFD0-FFD7 a restart marker, FFFF fill: all part of the data.
    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7) || next === 0xff) {
      at = ff + (next === 0xff ? 1 : 2);
      continue;
    }
    return ff;
  }
}

function isFrameMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== DHT && marker !== 0xc8 && marker !== 0xcc;
}

function readFrame(marker: number, payload: Buffer): Frame {
  if (marker !== 0xc0 && marker !== 0xc1) {
    throw unsupported(marker === 0xc2 || marker === 0xc6 ? 'progressive' : 'not baseline');
  }
  if (payload.length < 6) throw corrupt('a frame header cut short');
  if (payload[0] !== 8) throw unsupported(`${payload[0]}-bit samples`);
  const height = payload.readUInt16BE(1);
  const width = payload.readUInt16BE(3);
  const components = payload[5]!;
  if (components !== 1 && components !== 3) throw unsupported(`${components} components`);
  if (payload.length !== 6 + 3 * components) throw corrupt('a frame header of the wrong size');
  if (width === 0 || height === 0) throw corrupt('a frame with no size');
  if (width * height > MAX_PIXELS) {
    throw new PhotoRefusalError(
      'photo_too_many_pixels',
      `The photo has more than ${MAX_PIXELS} pixels.`,
    );
  }
  const ids = Array.from({ length: components }, (_, i) => payload[6 + 3 * i]!);
  return { width, height, ids };
}

/** The one scan: every frame component, in frame order, over the full spectrum, no refinement. */
function checkScanHeader(payload: Buffer, frame: Frame): void {
  const components = payload[0] ?? 0;
  if (components < 1 || components > 4 || payload.length !== 4 + 2 * components) {
    throw corrupt('a scan header of the wrong size');
  }
  const ids = Array.from({ length: components }, (_, i) => payload[1 + 2 * i]!);
  if (ids.join(',') !== frame.ids.join(',')) throw unsupported('a scan of part of the image');
  const [start, end, approximation] = payload.subarray(1 + 2 * components);
  if (start !== 0 || end !== 63 || approximation !== 0) throw unsupported('a partial scan');
}

/** A table segment must be exactly its tables: nothing else can ride along in it. */
function checkTable(marker: number, payload: Buffer): void {
  if (marker === DRI) {
    if (payload.length !== 2) throw corrupt('a restart interval of the wrong size');
    return;
  }
  let at = 0;
  while (at < payload.length) {
    const spec = payload[at]!;
    if (marker === DQT) {
      if (spec >> 4 > 1 || (spec & 0x0f) > 3) throw corrupt('a malformed quantisation table');
      at += 1 + 64 * ((spec >> 4) + 1);
    } else {
      if (spec >> 4 > 1 || (spec & 0x0f) > 3 || at + 17 > payload.length) {
        throw corrupt('a malformed Huffman table');
      }
      let codes = 0;
      for (let i = 1; i <= 16; i += 1) codes += payload[at + i]!;
      if (codes > 256) throw corrupt('a malformed Huffman table');
      at += 17 + codes;
    }
  }
  if (at !== payload.length || payload.length === 0) throw corrupt('a table of the wrong size');
}

function isExif(payload: Buffer): boolean {
  return payload.length >= 14 && payload.toString('latin1', 0, 6) === 'Exif\0\0';
}

/** IFD0 tag 0x0112 of a TIFF block, in either byte order. Anything malformed reads as upright. */
function readOrientation(tiff: Buffer): Orientation {
  const order = tiff.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return 1;
  const le = order === 'II';
  const u16 = (at: number) => (le ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number) => (le ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  if (u16(2) !== 42) return 1;
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return 1;
  const count = u16(ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return 1;
    if (u16(entry) === 0x0112 && u16(entry + 2) === 3) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? (value as Orientation) : 1;
    }
  }
  return 1;
}

/** A fresh APP1: `Exif\0\0`, a big-endian TIFF header, one IFD0 entry (Orientation), no next IFD. */
function orientationApp1(orientation: Orientation): Buffer {
  const out = Buffer.alloc(36);
  out.writeUInt16BE(0xffe1, 0);
  out.writeUInt16BE(34, 2);
  out.write('Exif\0\0', 4, 'latin1');
  out.write('MM', 10, 'latin1');
  out.writeUInt16BE(42, 12);
  out.writeUInt32BE(8, 14);
  out.writeUInt16BE(1, 18);
  out.writeUInt16BE(0x0112, 20);
  out.writeUInt16BE(3, 22);
  out.writeUInt32BE(1, 24);
  out.writeUInt16BE(orientation, 28);
  out.writeUInt32BE(0, 32);
  return out;
}
