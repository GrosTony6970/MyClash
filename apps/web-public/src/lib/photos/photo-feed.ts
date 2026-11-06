import { apiRequest } from '@myclash/api-client';
import type { PublicPhoto, PublicPhotoPage } from '@myclash/types';
import type { ScheduleRead } from '@/components/me/read-my-schedule';
import { tagOf } from './photo-tag';

/**
 * The public photo list's rules (design, "The public"; slice 4b): what the newest page, read every
 * 30 s, and Load more each do to the photos on screen. No React here: the hook is glue.
 *
 * The server pages newest first, 30 a page; `next` is the last row's `created_at` exactly as
 * Postgres wrote it (every one `+00:00`), so two of them compare as strings, microseconds kept.
 */

/** While the page is in view it reads the newest photos again this often (design: about 30 s). */
export const PHOTO_REREAD_MS = 30_000;

/** What the list rules read of a photo: the public list's, and her own in her personal space. */
export interface FeedPhoto {
  id: string;
  createdAt: string;
}
/** A page as the server answers it, newest first; `next` the following page's cursor. */
interface FeedPage<P extends FeedPhoto> {
  photos: P[];
  next: string | null;
}

/** The photos on screen, newest first, and whether the server holds older ones. */
export interface PhotoFeed<P extends FeedPhoto = PublicPhoto> {
  photos: P[];
  more: boolean;
}

/** One page's address: the picker's filter (`t:<id>`, `w:<id>` or none) and the cursor. */
export function photoPagePath(eventId: string, filter: string, before?: string): string {
  const query = new URLSearchParams();
  const tag = tagOf(filter);
  if (tag) query.set(tag.kind === 'tournament' ? 'tournamentId' : 'workshopId', tag.id);
  if (before) query.set('before', before);
  const search = query.toString();
  return `/api/v1/events/${eventId}/photos/public${search ? `?${search}` : ''}`;
}

/**
 * One read of a page. A 404 is an Event hidden from this visitor, or gone (photos Off answers an
 * empty page). A body that is not a page is a failed read: the browser suite's catch-all answers
 * `{}`, and a proxy may answer anything.
 */
export async function readPhotoPage(
  apiUrl: string,
  path: string,
  signal?: AbortSignal,
): Promise<ScheduleRead<PublicPhotoPage>> {
  const res = await apiRequest<unknown>(apiUrl, path, { signal });
  if (res.ok) return isPage(res.data) ? { kind: 'data', data: res.data } : { kind: 'failed' };
  if (res.kind === 'aborted') return { kind: 'aborted' };
  if (res.kind === 'http' && res.status === 404) return { kind: 'notFound' };
  return { kind: 'failed' };
}

function isPage(body: unknown): body is PublicPhotoPage {
  if (typeof body !== 'object' || body === null) return false;
  const { photos, next } = body as Partial<PublicPhotoPage>;
  return Array.isArray(photos) && (next === null || typeof next === 'string');
}

/**
 * The newest page on top of what is on screen. The page is the truth down to its own last photo:
 * a photo shown in that range and missing from it was deleted. Below it, every loaded photo stays.
 *
 * Three cases keep the list whole:
 * - the page is the last (`next` null): it is the whole list;
 * - it does not reach the photos on screen (more than 30 arrived since): it stands alone, and
 *   Load more reads on from it, so there is never a gap between the two;
 * - an Event of exactly 30 photos, after a Load more found none: Load more stays closed.
 */
export function feedAfterFirstPage<P extends FeedPhoto>(
  shown: PhotoFeed<P> | null,
  page: FeedPage<P>,
): PhotoFeed<P> {
  const { next } = page;
  const newestShown = shown?.photos[0];
  if (!shown || next === null || !newestShown || next > newestShown.createdAt) {
    return { photos: page.photos, more: next !== null };
  }
  // Every photo of the page is at least as new as `next`, so none of these is in it.
  const older = shown.photos.filter((p) => p.createdAt < next);
  const oldestShown = shown.photos[shown.photos.length - 1]!;
  const reachesOldest = older.length > 0 || page.photos.some((p) => p.id === oldestShown.id);
  return { photos: [...page.photos, ...older], more: reachesOldest ? shown.more : true };
}

/**
 * The next page under what is on screen, read from `before`; a photo already shown is not shown
 * twice (every photo of the page is older than `before`). A 30 s read that landed meanwhile and stood alone (more than 30 arrived) moved the list's
 * end: this page then belongs under photos no longer on screen, and would hide everything between,
 * so it is dropped and Load more reads on from the new end.
 */
export function feedAfterMore<P extends FeedPhoto>(
  shown: PhotoFeed<P>,
  page: FeedPage<P>,
  before: string,
): PhotoFeed<P> {
  if (feedCursor(shown) !== before) return shown;
  return { photos: [...shown.photos, ...page.photos], more: page.next !== null };
}

/** Where Load more reads from: the last photo's time, while the server holds older ones. */
export function feedCursor<P extends FeedPhoto>(feed: PhotoFeed<P>): string | null {
  const last = feed.photos[feed.photos.length - 1];
  return feed.more && last ? last.createdAt : null;
}
