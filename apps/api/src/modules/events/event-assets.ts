import type { UploadLimit } from '../../common/read-upload';

/**
 * Where the Event's and a Tournament's images live, and what they may be. The upload routes and
 * the archive (which carries these images, ruling 403) read them here.
 */
export const EVENT_LOGO_BUCKET = 'event-assets';
export const EVENT_LOGO_MAX_BYTES = 10 * 1024 * 1024;
export const ALLOWED_EVENT_LOGO_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);
/** The Event's and a Tournament's logo, read under it (`read-upload.ts`). */
export const EVENT_LOGO_UPLOAD: UploadLimit = {
  maxBytes: EVENT_LOGO_MAX_BYTES,
  tooLarge: 'Logo upload exceeds the 10 MB size limit.',
};

// Hero shares the bucket + MIME allowlist with logos; cap matches
// the logo limit so high-resolution camera JPEGs upload without a
// re-encode step.
export const EVENT_HERO_UPLOAD: UploadLimit = {
  maxBytes: 10 * 1024 * 1024,
  tooLarge: 'Hero upload exceeds the 10 MB size limit.',
};
export const ALLOWED_EVENT_HERO_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);
