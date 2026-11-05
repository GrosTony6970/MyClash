/**
 * The Event photos contract that the phone page and the API both read: the modes, the limits and
 * the codes of every refusal of `POST events/:eventId/photos`.
 *
 * It lives here for the reason `pin-strength.ts` does: the page checks a photo's size and a
 * caption's length before sending, and the API checks them again on the way in. Two copies of
 * "12 MiB" or of the code list would drift, and the first sign would be a refusal the page cannot
 * say in the reader's language.
 */

export const PHOTO_MODES = ['off', 'live', 'approve'] as const;
export type PhotoMode = (typeof PHOTO_MODES)[number];

/**
 * The photo mode of a raw Event read, or `null` when it carries none this build knows. `null` is
 * "unknown", never "off": the page then shows its form and lets the API decide.
 */
export function asPhotoMode(value: unknown): PhotoMode | null {
  return (PHOTO_MODES as readonly unknown[]).includes(value) ? (value as PhotoMode) : null;
}

/** One photo, as sent: the original is kept, never shrunk (design, "The uploader"). */
export const PHOTO_MAX_BYTES = 12 * 1024 * 1024;
/** Counted in characters (code points), as Postgres' `char_length` does. */
export const PHOTO_NAME_MAX = 40;
export const PHOTO_CAPTION_MAX = 200;

/**
 * The HEIF major brands (bytes 8-11 after `ftyp`) that mean "a HEIC photo". The page refuses one
 * before sending and the API refuses it again, each with the same "switch to Most Compatible"
 * sentence (ruling 432).
 */
export const PHOTO_HEIF_BRANDS = [
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'mif1',
  'msf1',
] as const;

/** What the photo's own bytes can be refused for (`jpeg-strip.ts`). */
export const PHOTO_FILE_REFUSALS = [
  'photo_not_jpeg',
  'photo_heic',
  'photo_unsupported_jpeg',
  'photo_too_many_pixels',
  'photo_corrupt',
] as const;
export type PhotoFileRefusal = (typeof PHOTO_FILE_REFUSALS)[number];

/** Every coded refusal of an upload. `file_too_large` is the shared upload reader's, not ours. */
export const PHOTO_UPLOAD_REFUSALS = [
  ...PHOTO_FILE_REFUSALS,
  'photo_link_invalid',
  'photos_off',
  'photos_window_closed',
  'photos_unavailable',
  'photos_busy',
  'photo_device_limit',
  'photo_event_limit',
  'photo_event_storage_full',
  'photo_text_too_long',
  'photo_tag_invalid',
  'photo_missing',
] as const;
export type PhotoUploadRefusal = (typeof PHOTO_UPLOAD_REFUSALS)[number];

export function isPhotoUploadRefusal(code: string | null): code is PhotoUploadRefusal {
  return code !== null && (PHOTO_UPLOAD_REFUSALS as readonly string[]).includes(code);
}

/**
 * Where a phone sends photos to an Event: web-public's `app/e/[eventSlug]/photos/send/`. The token
 * rides in the hash, so it never reaches a server log; the admin's QR code and poster print it.
 */
export function photoSendPath(eventSlug: string, token: string): string {
  return `/e/${encodeURIComponent(eventSlug)}/photos/send#${token}`;
}

/** The Event's photo QR link: its token (derived, never stored) and the version it was made from. */
export interface PhotoLink {
  token: string;
  version: number;
}

// ── The moderation queue (organisers; design, "Moderation") ─────────────────────────────────

/** A moderator's refusal when the photo is not, or no longer, in this Event. */
export const PHOTO_NOT_FOUND = 'photo_not_found';

/** The queue's tabs. Reported and Keep come with the public Report button (ruling 436). */
export const PHOTO_QUEUE_FILTERS = ['waiting', 'all'] as const;
export type PhotoQueueFilter = (typeof PHOTO_QUEUE_FILTERS)[number];

/** One photo in the moderation queue. Both links are signed for 15 minutes; null without one. */
export interface ModerationPhoto {
  id: string;
  status: 'waiting' | 'approved';
  uploaderName: string | null;
  caption: string | null;
  tag: { kind: 'tournament' | 'workshop'; name: string } | null;
  createdAt: string;
  previewUrl: string | null;
  /** The original, opened on tap. */
  originalUrl: string | null;
}

/** One page of the queue, newest first. `next` is the cursor of the following page. */
export interface PhotoQueuePage {
  photos: ModerationPhoto[];
  next: string | null;
}

/** The head of the organiser's Photos page. */
export interface PhotoSummary {
  mode: PhotoMode;
  eventSlug: string;
  eventName: string;
  /** Whether the photo bucket is configured. */
  storage: 'on' | 'off';
  lastHour: number;
  perHourCap: number;
  bytes: number;
  bytesCap: number;
  waiting: number;
  /** When every photo of the Event is deleted (ISO), or null when its dates cannot be read. */
  deletesAt: string | null;
  /** The Event's clock, to show `deletesAt` in it. */
  timezone: string;
}
