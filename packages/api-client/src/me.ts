/**
 * The `/api/v1/me` read, and the one name for the shape it answers with.
 *
 * ── Why this module exists ──────────────────────────────────────────────────
 * Eleven frontend sites each hand-wrote their own version of this payload, in
 * three apps, and no two agreed. That was not carelessness: the generated type
 * was `Record<string, never>` for `user`, `person`, `admin` and `session`,
 * because the DTO decorated inline object types and Swagger cannot see into
 * one. The official shape accepted nothing and read nothing, so every caller
 * guessed — and two of the guesses shipped bugs that no gate could see.
 *
 * `MeResponseDto` now emits nested schemas, so there is finally something
 * correct to import. `MeSession` is that import. It is an alias, deliberately:
 * a hand-maintained mirror would be a twelfth copy, and the twelfth copy is the
 * one that drifts.
 *
 * ── The path is here too, and that is the point ─────────────────────────────
 * `ME_PATH` sits beside the type so a caller cannot take one without the other.
 * A site that hard-codes the string is free to hard-code the shape as well,
 * which is exactly how `/api/v1/auth/me` ended up read by one page with its own
 * private idea of where the account id lives.
 */

import type { components } from './generated/schema';
import { apiRequest, type ApiResult } from './request';

/** The body of `GET /api/v1/me`. Generated from the API's own DTO. */
export type MeSession = components['schemas']['MeResponseDto'];

/** The claimed/guest/anonymous discriminant. `anonymous` is a 200, never a 401. */
export type MeSessionType = MeSession['type'];

/** The admin grant block, present for org members and platform staff alike. */
export type MeAdmin = NonNullable<MeSession['admin']>;

export const ME_PATH = '/api/v1/me';

/**
 * Read the current identity. Never throws — a failure is a value, same as every
 * other `apiRequest` caller gets.
 *
 * Being signed out is NOT a failure here: the route is `@Public()` and answers
 * `{ type: 'anonymous' }` with a 200. A `network` result means the API could not
 * be asked, which is a different thing entirely and must not be treated as a
 * signed-out session.
 */
export function fetchMe(
  baseUrl: string,
  init: Omit<RequestInit, 'body'> = {},
): Promise<ApiResult<MeSession>> {
  return apiRequest<MeSession>(baseUrl, ME_PATH, init);
}
