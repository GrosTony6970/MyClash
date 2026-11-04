import { describe, expect, it } from 'vitest';
import { PHOTO_MAX_BYTES } from '@myclash/types';
import { localRefusal, photoKindOf } from './photo-checks';

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
/** An ISO-BMFF head: a box size, `ftyp`, then the major brand. */
const ftyp = (brand: string) => bytes(0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii(brand));

const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, ...ascii('JFIF'), 0, 1);
const PNG = bytes(0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d);

describe('what kind of photo the first bytes say', () => {
  it('a JPEG starts FF D8 FF, even when only those three bytes are there', () => {
    expect(photoKindOf(JPEG)).toBe('jpeg');
    expect(photoKindOf(bytes(0xff, 0xd8, 0xff))).toBe('jpeg');
  });

  it.each(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'])(
    'an ftyp box of brand %s is HEIC',
    (brand) => {
      expect(photoKindOf(ftyp(brand))).toBe('heic');
    },
  );

  it('an MP4, a PNG or two bytes are something else', () => {
    expect(photoKindOf(ftyp('isom'))).toBe('other');
    expect(photoKindOf(PNG)).toBe('other');
    expect(photoKindOf(bytes(0xff, 0xd8))).toBe('other');
  });
});

describe('the refusal said before a byte is sent', () => {
  it('12 MiB is accepted, one byte more is too large', () => {
    expect(localRefusal(PHOTO_MAX_BYTES, JPEG)).toBeNull();
    expect(localRefusal(PHOTO_MAX_BYTES + 1, JPEG)).toBe('file_too_large');
  });

  it('a HEIC and anything not a JPEG are refused by name', () => {
    expect(localRefusal(1000, ftyp('heic'))).toBe('photo_heic');
    expect(localRefusal(1000, PNG)).toBe('photo_not_jpeg');
  });
});
