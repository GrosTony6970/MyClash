import type { ApiResult } from '@myclash/api-client';
import { CLUB_NOT_MADE_CODE, LINK_EXPIRED_CODE } from '@myclash/types';
import { signupRefusedKey } from '@/lib/sign-in-failure';

/** The 200 body of the organiser's choose-password door (API `signupChoosePassword`). */
export interface ClubBody {
  code?: unknown;
  saved?: unknown;
  signedIn?: unknown;
  next?: unknown;
}

/**
 * What the organiser's "choose your password" door answered, as its page acts on it.
 *
 * - `opened`: the password is saved, she is signed in with it, the club is made: open `next`.
 * - `sign-in`: saved and the club made, but the door handed no login (ruling 358).
 * - `not-saved` / `unknown`: the club is made and she is signed in by the code, but the auth
 *   server refused the password, or never judged it.
 * - `restart`: the code is spent and no club stands: a club not made (ruling 363), or a link
 *   used or too old. The form would only meet "expired": the way on is a second sign-up.
 * - `refused`: the sentence key of a coded refusal the form stays open on (`signupRefusedKey`,
 *   the sign-up page's own): a link nobody judged, sign-ups off, read-only, the lockdown.
 * - `weak`, `network`, `failed`: the form stays open with its sentence.
 */
export type ClubAnswer = { kind: 'opened'; next: string } | ClubOutcome | ClubRefusal;
/** The code is spent: the page leaves the form for what it says next. */
export type ClubOutcome =
  | { kind: 'not-saved' | 'unknown'; next: string }
  | { kind: 'sign-in' }
  | { kind: 'restart'; key: string };
/** The form stays open, with the sentence of the refusal. */
export type ClubRefusal =
  { kind: 'refused'; key: string } | { kind: 'weak' | 'network' | 'failed' };

export function isClubOutcome(answer: ClubAnswer): answer is ClubOutcome {
  return ['sign-in', 'not-saved', 'unknown', 'restart'].includes(answer.kind);
}

export function clubAnswer(result: ApiResult<ClubBody | undefined>): ClubAnswer {
  if (!result.ok) {
    if (result.kind === 'network' || result.kind === 'aborted') return { kind: 'network' };
    if (result.status === 400 && result.code === 'weak_password') return { kind: 'weak' };
    return refusal(result.code);
  }
  const answer = result.data ?? {};
  if (typeof answer.code === 'string') return refusal(answer.code);
  const next = typeof answer.next === 'string' ? answer.next : null;
  if (!next || (answer.saved !== true && answer.saved !== false && answer.saved !== 'unknown')) {
    return { kind: 'failed' };
  }
  if (answer.saved === false) return { kind: 'not-saved', next };
  if (answer.saved === 'unknown') return { kind: 'unknown', next };
  return answer.signedIn === true ? { kind: 'opened', next } : { kind: 'sign-in' };
}

function refusal(code: string | null): ClubAnswer {
  const key = signupRefusedKey(code ?? undefined);
  if (!key) return { kind: 'failed' };
  const spent = code === CLUB_NOT_MADE_CODE || code === LINK_EXPIRED_CODE;
  return { kind: spent ? 'restart' : 'refused', key };
}
