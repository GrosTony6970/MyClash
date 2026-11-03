import type { UploadLimit } from '../../common/read-upload';

/**
 * Where a Workshop's cover lives, and what it may be. The upload route and the archive (which
 * carries the cover, ruling 406) read them here.
 *
 * Workshop logos live in their own bucket (not the shared 10 MB `event-assets`) so the 15 MB cap
 * is actually honored — a shared bucket's fileSizeLimit would reject the larger uploads.
 */
export const WORKSHOP_LOGO_BUCKET = 'workshop-assets';
export const WORKSHOP_LOGO_MAX_BYTES = 15 * 1024 * 1024;
/** The Workshop logo, read under it (`read-upload.ts`). */
export const WORKSHOP_LOGO_UPLOAD: UploadLimit = {
  maxBytes: WORKSHOP_LOGO_MAX_BYTES,
  tooLarge: 'Logo upload exceeds the 15 MB size limit.',
};
export const ALLOWED_WORKSHOP_LOGO_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);
