import type { ApiResult } from '@myclash/api-client';
import { LINK_EXPIRED_CODE, LINK_UNCHECKED_CODE } from '@myclash/types';

/** The 200 body of the "choose your password" door (API `publicChoosePassword`). */
export interface ChooseBody {
  code?: unknown;
  saved?: unknown;
  signedIn?: unknown;
  next?: unknown;
}

/**
 * What the "choose your password" door answered, as the page acts on it.
 *
 * - `signed-in`: the password is saved and she is signed in with it: the page opens `next`.
 * - `sign-in`: saved, but the door handed no login (ruling 358): she signs in with it.
 * - `not-saved` / `unknown`: the code was spent and she is signed in by its session, but the
 *   auth server refused the write, or never judged it. The page offers "Set a password".
 * - `expired`: the link was used or is too old (401 `link_expired`).
 * - `unchecked`: nobody judged the link (ruling 360): open it again.
 * - `weak`: the password does not meet the policy; the link is not spent.
 * - `network`: no answer, or no answer in time.
 * - `failed`: anything else, the edge's 401 or 503 with no code among them.
 */
export type ChooseAnswer = { kind: 'signed-in'; next: string } | ChooseOutcome | ChooseRefusal;
/** The code is spent: the page leaves the form for what it says next. */
export type ChooseOutcome = { kind: 'sign-in' | 'not-saved' | 'unknown' };
/** The form stays open, with the sentence of the refusal. */
export type ChooseRefusal = { kind: 'expired' | 'unchecked' | 'weak' | 'network' | 'failed' };

export function isOutcome(answer: ChooseAnswer): answer is ChooseOutcome {
  return answer.kind === 'sign-in' || answer.kind === 'not-saved' || answer.kind === 'unknown';
}

export function chooseAnswer(result: ApiResult<ChooseBody | undefined>): ChooseAnswer {
  if (!result.ok) {
    if (result.kind === 'network' || result.kind === 'aborted') return { kind: 'network' };
    if (result.status === 401 && result.code === LINK_EXPIRED_CODE) return { kind: 'expired' };
    if (result.status === 400 && result.code === 'weak_password') return { kind: 'weak' };
    return { kind: 'failed' };
  }
  const answer = result.data ?? {};
  if (answer.code === LINK_UNCHECKED_CODE) return { kind: 'unchecked' };
  if (answer.saved === false) return { kind: 'not-saved' };
  if (answer.saved === 'unknown') return { kind: 'unknown' };
  if (answer.saved !== true) return { kind: 'failed' };
  if (answer.signedIn !== true) return { kind: 'sign-in' };
  return { kind: 'signed-in', next: typeof answer.next === 'string' ? answer.next : '/' };
}
