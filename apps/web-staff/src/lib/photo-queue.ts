import {
  PHOTO_NOT_FOUND,
  type ModerationPhoto,
  type PhotoQueueFilter,
  type PhotoQueuePage,
} from '@myclash/types';
import type { ApiResult } from '@myclash/api-client';

/**
 * The staff photo queue's rules, with no React and no network: the hook (`usePhotoQueue.ts`) is
 * glue over these, and this app's tests run in node.
 */

/** A signed link lives 10 to 15 minutes from the read: older than this, a broken image may be one. */
export const STALE_LINKS_MS = 10 * 60_000;

/** The code a staff call answers once the Event is archived (`scoring-refusals.ts`). */
const EVENT_CLOSED = 'event_results_frozen';

export interface PhotoQueueState {
  photos: ModerationPhoto[];
  next: string | null;
  /** Bumped by each read of page 1: a next page asked in an older one is dropped. */
  generation: number;
  /** When page 1 was read (ms), the age of its signed links. */
  loadedAt: number;
}

export type PhotoQueueAction =
  | { type: 'reading' }
  | { type: 'read'; page: PhotoQueuePage; at: number }
  | { type: 'more'; page: PhotoQueuePage; generation: number };

export const EMPTY_QUEUE: PhotoQueueState = { photos: [], next: null, generation: 0, loadedAt: 0 };

/**
 * The race: a Load more in flight when the tab changes or a write's reload lands. Each read of
 * page 1 starts a generation when it is asked for (`reading`), and closes Load more until it
 * lands; a next page from an older generation is dropped. So the Waiting page 2 never lands under
 * All, even when All's page 1 fails, nor a page read before a delete under the fresh page 1.
 */
export function photoQueueReducer(
  state: PhotoQueueState,
  action: PhotoQueueAction,
): PhotoQueueState {
  if (action.type === 'reading') {
    return { ...state, next: null, generation: state.generation + 1 };
  }
  if (action.type === 'read') {
    return {
      photos: action.page.photos,
      next: action.page.next,
      generation: state.generation + 1,
      loadedAt: action.at,
    };
  }
  if (action.generation !== state.generation) return state;
  return { ...state, photos: [...state.photos, ...action.page.photos], next: action.page.next };
}

/** One page of the login's queue. The cursor is a row's `created_at` exactly as written. */
export function photoPagePath(filter: PhotoQueueFilter, before?: string): string {
  const cursor = before ? `&before=${encodeURIComponent(before)}` : '';
  return `/api/v1/staff/photos?filter=${filter}${cursor}`;
}

/**
 * A broken image on an old read: its link has likely expired, so read fresh links. It cannot
 * loop: the new read is fresh, and a broken image on a fresh read reloads nothing.
 */
export function shouldReloadOnImageError(loadedAt: number, now: number): boolean {
  return now - loadedAt > STALE_LINKS_MS;
}

/**
 * The two refusals this screen words itself, checked before `failureMessage`, which would show
 * the server's English: a photo another moderator deleted, and an Event archived meanwhile
 * (ruling 438). A 403 reaches here as `unauthenticated`, a 404 as `http`: the code decides.
 */
export function photoFailureKey(
  res: ApiResult<unknown>,
): 'scoring.photos.alreadyDeleted' | 'scoring.photos.eventClosed' | null {
  if (res.ok || (res.kind !== 'http' && res.kind !== 'unauthenticated')) return null;
  if (res.code === PHOTO_NOT_FOUND) return 'scoring.photos.alreadyDeleted';
  if (res.code === EVENT_CLOSED) return 'scoring.photos.eventClosed';
  return null;
}
