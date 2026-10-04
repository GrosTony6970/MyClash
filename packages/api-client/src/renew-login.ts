/**
 * Renew the login once on a 401, then send the request once more (rulings 131, 153).
 *
 * The login cookie lasts an hour; the refresh cookie lasts thirty days. Only `GET /api/v1/me`
 * turns the one into the other (the API's `AuthService.getMe`, the one route that takes a reply
 * to set cookies on). Paul taps Follow after lunch: his hour is up, the tap answers 401, and
 * until this he had to reload the page. Now the client asks `/me` once and, when it answers
 * `claimed`, sends the same request again — once. A second 401 is the answer.
 *
 * `apiRequest` (web-admin, web-public) and `createApiClient` (web-staff) both fetch through
 * `fetchRenewingLogin`, so the three apps renew the same way. The pad's queue sends its hits and
 * cards through it too (`SyncEngine.postExchange`): an organiser who scores for more than an hour.
 *
 * It does nothing:
 *   - on a server: web-public's server pages forward the login cookie by hand and have no jar a
 *     renewed cookie could land in;
 *   - for `/me` itself, which never answers 401 (signed out is a 200 `anonymous`);
 *   - for the identity doors (`/api/v1/auth/*`, `/api/v1/staff-auth/*`): they make or read an
 *     identity themselves, and their 401 is their answer — a wrong password or PIN, no PIN
 *     session. Sent twice, a wrong PIN would spend two tries of its throttle (10 an hour);
 *   - for a body that can be read only once (a stream);
 *   - for a 403, or anything but a 401.
 * A PIN session (web-staff's `mc_staff`) is not renewable: `/me` answers for the personal login,
 * so a refused PIN request is retried at most once and answers its own 401.
 *
 * The race it handles: several requests refused at the same moment (a page loading its reads).
 * They share one `/me` call rather than spend the refresh token once each; every one of them
 * retries when that call answers. A 401 that lands just after that call settled asks `/me` once
 * more — cheap, the login is fresh by then. The shared call is not keyed by base URL: each app
 * has one API origin in the browser. It ignores a caller's abort signal; a caller that aborted
 * meanwhile gets `aborted` from its retry.
 *
 * Not covered: raw `fetch` sites (most of web-public's pages, the pad's Pool poll, the live
 * board's poll). The organiser routes answer an expired login 401 too: many controllers turn a
 * missing identity into `'anonymous'`, and `assertOrgRole` asks it to sign in (ruling 154).
 */

import type { MeSession } from './me';

export const ME_PATH = '/api/v1/me';

const IDENTITY_DOORS = ['/api/v1/auth/', '/api/v1/staff-auth/'];

let renewing: Promise<boolean> | null = null;

/** Ask `/me` to renew the login; true when it answers that the login is back. */
function renewLogin(baseUrl: string): Promise<boolean> {
  renewing ??= fetch(`${baseUrl}${ME_PATH}`, { credentials: 'include', cache: 'no-store' })
    .then(async (res) => res.ok && ((await res.json()) as MeSession).type === 'claimed')
    .catch(() => false)
    .finally(() => {
      renewing = null;
    });
  return renewing;
}

const sendsOnce = (body: RequestInit['body']) =>
  typeof ReadableStream !== 'undefined' && body instanceof ReadableStream;

/** `fetch(baseUrl + path, init)`, renewing the login once on a 401 and retrying once. */
export async function fetchRenewingLogin(
  baseUrl: string,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, init);
  if (res.status !== 401 || typeof window === 'undefined') return res;
  if (path === ME_PATH || sendsOnce(init.body)) return res;
  if (IDENTITY_DOORS.some((door) => path.startsWith(door))) return res;
  return (await renewLogin(baseUrl)) ? fetch(url, init) : res;
}
