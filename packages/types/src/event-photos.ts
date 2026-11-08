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

/**
 * Does the Event show its photos to the public: Live, or Approve first? Off and an unknown mode
 * do not. The public list, the photos page and the home card read it here.
 */
export function photosShown(mode: PhotoMode | null): boolean {
  return mode === 'live' || mode === 'approve';
}

/** One photo, as sent: the original is kept, never shrunk (design, "The uploader"). */
export const PHOTO_MAX_BYTES = 12 * 1024 * 1024;
/** Counted in characters (code points), as Postgres' `char_length` does. */
export const PHOTO_NAME_MAX = 40;
export const PHOTO_CAPTION_MAX = 200;
/**
 * The name a photo sent from a personal space carries: the profile name, or the sign-up name, cut
 * at the profile's own limit (design Goal 11, ruling 458). A name typed on the QR page stays at 40.
 */
export const PHOTO_ACCOUNT_NAME_MAX = 200;

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
  // A photo sent from a personal space (slice 6a): not one of her Events, no name to carry, her
  // account's hour.
  'photo_not_your_event',
  'photo_no_name',
  'photo_account_limit',
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

/** The queue's tabs, in the order the screens show them. Reported lists photos with a report. */
export const PHOTO_QUEUE_FILTERS = ['waiting', 'reported', 'all'] as const;
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
  /** The phones that reported it (at most `PHOTO_REPORTS_PER_PHOTO`). */
  reportCount: number;
  /** What they wrote, newest change first (466); a report with no comment adds none. */
  reportComments: string[];
  /**
   * The newest report change (a report's time, or when its comment changed) as the database wrote
   * it, or null with none: Keep's bound (457, 466).
   */
  lastReportAt: string | null;
}

/** One page of the queue, newest first. `next` is the cursor of the following page. */
export interface PhotoQueuePage {
  photos: ModerationPhoto[];
  next: string | null;
}

// ── The public list and the Report (design, "The public") ───────────────────────────────────

/**
 * An approved photo as the public sees it: no status, nothing of the phone that sent it, and
 * nothing of its reports, whose comments are for the moderators only.
 */
export type PublicPhoto = Omit<
  ModerationPhoto,
  'status' | 'reportCount' | 'reportComments' | 'lastReportAt'
>;

/** One page of an Event's public photos, newest first. `next` is the following page's cursor. */
export interface PublicPhotoPage {
  photos: PublicPhoto[];
  next: string | null;
}

// ── A personal space's own photos (design Goal 11, slice 6) ─────────────────────────────────

/**
 * A photo she sent from her personal space, as she sees it: its status and both images, a
 * waiting one too (it is hers). Her name is the page's `posterName`, not repeated per photo.
 */
export type MyPhoto = Pick<
  ModerationPhoto,
  'id' | 'status' | 'caption' | 'tag' | 'createdAt' | 'previewUrl' | 'originalUrl'
>;

/**
 * One page of her photos of one Event, newest first, and the name her photos carry (null: she has
 * none yet, and an upload is refused with `photo_no_name`). `next` as `PublicPhotoPage.next`.
 */
export interface MyPhotos {
  posterName: string | null;
  /**
   * Whether a photo can be sent to the Event now (ruling 463): photos not Off, the upload days
   * open, the Event not archived. Her personal space shows its form only then.
   */
  sendOpen: boolean;
  photos: MyPhoto[];
  next: string | null;
}

/** A phone's refusal when it has reported its photos for this hour. */
export const PHOTO_REPORT_LIMIT = 'photo_report_limit';
/** The photos one phone may report in an hour; a repeat of one photo adds no report. */
export const PHOTO_REPORTS_PER_HOUR = 30;
/**
 * The reports one photo keeps (ruling 449): past it a Report is answered and not stored. A
 * phone with no cookie is a new phone each time, so only this bounds the rows a script can add.
 */
export const PHOTO_REPORTS_PER_PHOTO = 20;
/** The longest comment a Report takes (ruling 452), as a caption. */
export const PHOTO_REPORT_COMMENT_MAX = 200;

/** The Report's body: why the phone reports the photo, optional (452). */
export interface PhotoReportBody {
  comment?: string | null;
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
  /** The photos with at least one report. */
  reported: number;
  /** When every photo of the Event is deleted (ISO), or null when its dates cannot be read. */
  deletesAt: string | null;
  /** The Event's clock, to show `deletesAt` in it. */
  timezone: string;
}

/** The organisers' summary: it also says whether every zip slot is taken (ruling 497). */
export interface OrganiserPhotoSummary extends PhotoSummary {
  downloadsBusy: boolean;
}

/**
 * One row of the platform's Photos page (`GET admin/photos/events`, ruling 493): an Event whose
 * photos are not Off, or that still holds photos, with its club and what waits on a moderator.
 */
export interface PlatformPhotoEvent {
  id: string;
  name: string;
  clubName: string | null;
  startDate: string | null;
  endDate: string | null;
  mode: PhotoMode;
  waiting: number;
  reported: number;
}

/** The most Events the platform's Photos page lists, newest first. */
export const PLATFORM_PHOTO_EVENTS_MAX = 200;
