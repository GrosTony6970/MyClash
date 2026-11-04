import { describe, expect, it } from 'vitest';
import {
  asPhotoMode,
  isPhotoUploadRefusal,
  PHOTO_CAPTION_MAX,
  PHOTO_FILE_REFUSALS,
  PHOTO_HEIF_BRANDS,
  PHOTO_MAX_BYTES,
  PHOTO_MODES,
  PHOTO_NAME_MAX,
  PHOTO_UPLOAD_REFUSALS,
} from './event-photos';

describe('the photo contract the page and the API share', () => {
  it('holds the limits of the design', () => {
    expect(PHOTO_MAX_BYTES).toBe(12 * 1024 * 1024);
    expect(PHOTO_NAME_MAX).toBe(40);
    expect(PHOTO_CAPTION_MAX).toBe(200);
    expect(PHOTO_MODES).toEqual(['off', 'live', 'approve']);
  });

  it('names the HEIF brands of a HEIC photo once, for both sides', () => {
    expect([...PHOTO_HEIF_BRANDS].sort()).toEqual(
      ['heic', 'heim', 'heis', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].sort(),
    );
  });

  it('names sixteen distinct refusals, the five file ones among them', () => {
    expect(PHOTO_UPLOAD_REFUSALS).toHaveLength(16);
    expect(new Set(PHOTO_UPLOAD_REFUSALS).size).toBe(16);
    for (const code of PHOTO_FILE_REFUSALS) expect(PHOTO_UPLOAD_REFUSALS).toContain(code);
  });

  it('reads the mode of a raw Event read, and an unknown one as null, never as off', () => {
    expect(asPhotoMode('approve')).toBe('approve');
    expect(asPhotoMode('off')).toBe('off');
    expect(asPhotoMode('live')).toBe('live');
    expect(asPhotoMode(undefined)).toBeNull();
    expect(asPhotoMode('banana')).toBeNull();
  });

  it('tells a photo refusal from any other code', () => {
    expect(isPhotoUploadRefusal('photos_busy')).toBe(true);
    expect(isPhotoUploadRefusal('photo_heic')).toBe(true);
    expect(isPhotoUploadRefusal('file_too_large')).toBe(false);
    expect(isPhotoUploadRefusal(null)).toBe(false);
  });
});
