import { BadRequestException } from '@nestjs/common';
import type { Upload, UploadLimit } from '../../common/read-upload';
import { ensurePublicBucket } from '../../common/storage-bucket';
import type { SupabaseService } from '../supabase/supabase.service';

/**
 * Where the Event's, a Tournament's and a team's images live, and what they may be. The upload
 * routes and the archive (which carries these images, ruling 403) read them here.
 */
export const EVENT_LOGO_BUCKET = 'event-assets';
export const EVENT_LOGO_MAX_BYTES = 10 * 1024 * 1024;
export const ALLOWED_EVENT_LOGO_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);
/** The Event's, a Tournament's and a team's logo, read under it (`read-upload.ts`). */
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

/** What each image of this bucket accepts, and the sentences of its two refusals. */
const IMAGE_KINDS = {
  logo: {
    types: ALLOWED_EVENT_LOGO_MIME_TYPES,
    noFile: 'No logo file uploaded.',
    wrongType: 'Logo upload must be a PNG, JPEG, or WebP image.',
  },
  hero: {
    types: ALLOWED_EVENT_HERO_MIME_TYPES,
    noFile: 'No hero file uploaded.',
    wrongType: 'Hero upload must be a PNG, JPEG, or WebP image.',
  },
} as const;

/**
 * Stores an Event's, a Tournament's or a team's image in the public `event-assets` bucket and
 * answers its public link. The one owner of these uploads: the empty-file and type checks, the
 * bucket made on first use, and the path.
 *
 * The path is `{folder}/{kind}-{ms}-{name}.{ext}`: a new path per upload, so the CDN serves the
 * new file. The file's own name is cut to lowercase letters, digits and hyphens: it is the
 * caller's to send, and a `/` or a `..` in it would put the file outside `folder`.
 */
export async function storeEventImage(
  storage: SupabaseService['service']['storage'],
  folder: string,
  file: Upload,
  kind: keyof typeof IMAGE_KINDS = 'logo',
): Promise<string> {
  const rules = IMAGE_KINDS[kind];
  if (!file.buffer.length) throw new BadRequestException(rules.noFile);
  if (!rules.types.has(file.mimetype)) throw new BadRequestException(rules.wrongType);

  await ensurePublicBucket(
    storage,
    EVENT_LOGO_BUCKET,
    EVENT_LOGO_MAX_BYTES,
    ALLOWED_EVENT_LOGO_MIME_TYPES,
  );
  const extension =
    file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
  const safeBase = file.filename
    .toLowerCase()
    .replace(/\.[^.]+$/u, '')
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60);
  const path = `${folder}/${kind}-${Date.now()}-${safeBase || 'image'}.${extension}`;

  const { error } = await storage
    .from(EVENT_LOGO_BUCKET)
    .upload(path, file.buffer, { contentType: file.mimetype, upsert: true });
  if (error) throw new BadRequestException(error.message);
  return storage.from(EVENT_LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
}
