import type { ApiResult } from '@myclash/api-client';

/** The message a refused Follow or Unfollow shows. */
export type FollowRefusal =
  | 'publicApp.following.signInToFollow'
  | 'publicApp.following.prefersNotFollowed'
  | 'publicApp.following.followUpdateError';

/** `PREFERS_NOT_FOLLOWED` in the API's follows.service.ts. */
const PREFERS_NOT_FOLLOWED = 'prefers_not_followed';

/**
 * What the server's answer to a Follow or Unfollow tap means for the page (operator ruling 121b).
 * The button flips only on success. The server decides who may follow: signed out is a 401, and
 * a person who prefers not to be followed is a 403 with its own code. Any other 403 — an archived
 * Event refuses every follow write — and anything else failed, without blaming the person.
 */
export function followRefusal(result: ApiResult<unknown>): FollowRefusal | null {
  if (result.ok) return null;
  if (result.kind === 'unauthenticated' && result.status === 401) {
    return 'publicApp.following.signInToFollow';
  }
  if (result.kind === 'unauthenticated' && result.code === PREFERS_NOT_FOLLOWED) {
    return 'publicApp.following.prefersNotFollowed';
  }
  return 'publicApp.following.followUpdateError';
}
