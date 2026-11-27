import { describe, expect, it } from 'vitest';
import { isCameraJpeg } from './camera-jpeg';

/**
 * Hand-built marker streams: the walk reads structure, not pixels. Each refused case is the shape
 * the API refuses (`apps/api/src/modules/photos/jpeg-strip.ts`), so the phone converts it first.
 */

const seg = (marker: number, payload: number[]) => {
  const length = payload.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...payload];
};
const frame = (marker = 0xc0, bits = 8, ids = [1, 2, 3]) =>
  seg(marker, [bits, 0, 16, 0, 16, ids.length, ...ids.flatMap((id) => [id, 0x11, 0])]);
const scan = (ids = [1, 2, 3], start = 0, end = 63, approximation = 0) =>
  seg(0xda, [ids.length, ...ids.flatMap((id) => [id, 0]), start, end, approximation]);
/** Coded data with a stuffed byte, a restart marker and fill: all part of the scan. */
const DATA = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xff, 0x00];
const EXIF = seg(0xe1, [...'Exif'].map((c) => c.charCodeAt(0)).concat([0, 0, 0x4d, 0x4d]));
const DQT = seg(0xdb, [0, ...new Array<number>(64).fill(1)]);
const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
const jpeg = (...parts: number[][]) => new Uint8Array([...SOI, ...parts.flat(), ...EOI]);

const CAMERA = jpeg(EXIF, DQT, frame(), scan(), DATA);

describe('whether the API takes a JPEG as it is', () => {
  it('a camera JPEG: one baseline frame, one full scan', () => {
    expect(isCameraJpeg(CAMERA)).toBe(true);
    expect(isCameraJpeg(jpeg(frame(0xc1), scan(), DATA))).toBe(true);
    expect(isCameraJpeg(jpeg(frame(0xc0, 8, [1]), scan([1]), DATA))).toBe(true);
  });

  it('bytes after the end of the image are not read (a Motion Photo, a second image)', () => {
    expect(isCameraJpeg(new Uint8Array([...CAMERA, 0x00, 0xff, 0xd8, 0x01]))).toBe(true);
  });

  it('a progressive JPEG is not', () => {
    expect(isCameraJpeg(jpeg(frame(0xc2), scan(), DATA))).toBe(false);
  });

  it('a second scan, a partial one or one of some components is not', () => {
    expect(isCameraJpeg(jpeg(frame(), scan(), DATA, scan(), DATA))).toBe(false);
    expect(isCameraJpeg(jpeg(frame(), scan([1, 2, 3], 0, 5), DATA))).toBe(false);
    expect(isCameraJpeg(jpeg(frame(), scan([1, 2, 3], 0, 63, 0x10), DATA))).toBe(false);
    expect(isCameraJpeg(jpeg(frame(), scan([1]), DATA))).toBe(false);
  });

  it('12-bit samples or four components (CMYK) are not', () => {
    expect(isCameraJpeg(jpeg(frame(0xc0, 12), scan(), DATA))).toBe(false);
    expect(isCameraJpeg(jpeg(frame(0xc0, 8, [1, 2, 3, 4]), scan([1, 2, 3, 4]), DATA))).toBe(false);
  });

  it('a damaged one is not: cut short, a scan before its frame, no scan, not a JPEG', () => {
    expect(isCameraJpeg(CAMERA.subarray(0, CAMERA.length - 2))).toBe(false);
    expect(isCameraJpeg(CAMERA.subarray(0, 30))).toBe(false);
    expect(isCameraJpeg(jpeg(scan(), DATA, frame()))).toBe(false);
    expect(isCameraJpeg(jpeg(frame()))).toBe(false);
    expect(isCameraJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(isCameraJpeg(jpeg(seg(0xf0, [0, 0]), frame(), scan(), DATA))).toBe(false);
  });
});
