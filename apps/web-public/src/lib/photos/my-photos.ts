import { apiRequest, failureCode } from '@myclash/api-client';
import type { MyPhotos } from '@myclash/types';

/**
 * Her own photos of one Event, on the Photos tab of her personal space (design Goal 11, slice
 * 6b): the list's address, its read, and her Delete. No React here: `use-my-photos.ts` is glue.
 *
 * The list pages as the public one does (30 a page, `next` = the last photo's time) and goes
 * through the same rules (`photo-feed.ts`). Two races, named:
 * - a read of the first page that left before a Delete and answers after it still holds the
 *   photo: every answer passes through `withoutDeleted` before it reaches the screen;
 * - two reads of the first page (two photos sent close together): the hook aborts the older one
 *   when it starts the newer, so an older answer never lands last.
 */

type Translate = (key: string, values?: Record<string, string>) => string;

export type MyPhotosRead =
  { kind: 'data'; data: MyPhotos } | { kind: 'failed' } | { kind: 'aborted' };

/** One page's address: her own Event route, from `before` when given. */
export function myPhotosPath(eventId: string, before?: string): string {
  const base = `/api/v1/me/events/${eventId}/photos`;
  return before ? `${base}?${new URLSearchParams({ before }).toString()}` : base;
}

/**
 * One read of a page. Every failure is the same "could not load": a 401 is a login the API
 * client could not renew, a 404 an Event gone, and a body that is not her page (the browser
 * suite's catch-all answers `{}`, a proxy may answer anything) is no page.
 */
export async function readMyPhotos(
  apiUrl: string,
  path: string,
  signal?: AbortSignal,
): Promise<MyPhotosRead> {
  const res = await apiRequest<unknown>(apiUrl, path, { signal });
  if (res.ok) return isMyPhotos(res.data) ? { kind: 'data', data: res.data } : { kind: 'failed' };
  return res.kind === 'aborted' ? { kind: 'aborted' } : { kind: 'failed' };
}

function isMyPhotos(body: unknown): body is MyPhotos {
  if (typeof body !== 'object' || body === null) return false;
  const { photos, next, posterName, sendOpen } = body as Partial<MyPhotos>;
  return (
    Array.isArray(photos) &&
    (next === null || typeof next === 'string') &&
    (posterName === null || typeof posterName === 'string') &&
    typeof sendOpen === 'boolean'
  );
}

/** The page without the photos she deleted meanwhile; its cursor is kept. */
export function withoutDeleted(page: MyPhotos, deleted: ReadonlySet<string>): MyPhotos {
  return { ...page, photos: page.photos.filter((photo) => !deleted.has(photo.id)) };
}

/**
 * Her Delete. A photo already gone (`photo_not_found`: another tab deleted it) is deleted as far
 * as she can tell; any other 404 (a proxy, a wrong route) is a failure, and the photo stays.
 */
export async function deleteMyPhoto(
  apiUrl: string,
  eventId: string,
  photoId: string,
  t: Translate,
): Promise<{ kind: 'deleted' } | { kind: 'failed'; message: string }> {
  const res = await apiRequest<void>(apiUrl, `/api/v1/me/events/${eventId}/photos/${photoId}`, {
    method: 'DELETE',
  });
  if (res.ok || failureCode(res) === 'photo_not_found') return { kind: 'deleted' };
  return { kind: 'failed', message: t('publicApp.myPhotos.deleteFailed') };
}
