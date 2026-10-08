import { apiRequest, failureCode, type ApiResult } from '@myclash/api-client';
import { WRONG_CURRENT_PASSWORD_CODE } from '@myclash/types';

/**
 * The security page's two doors that ask the current password again.
 *
 * Each request answers with a CODE, never a sentence: the copy stays in the page, as in the
 * login's `auth-requests.ts`.
 *
 * A wrong current password is the API's coded 403 (operator ruling 329). A 401 the API wrote
 * is an ended session, and it reaches this module only after `apiRequest` asked `/me` to renew
 * the login and sent the request again. A 401 with no code is the edge's: a failed request.
 */
export type SecurityAnswer =
  'ok' | 'wrong_password' | 'session_ended' | 'bad_request' | 'network' | 'failed';

function answerOf(result: ApiResult<unknown>): SecurityAnswer {
  if (result.ok) return 'ok';
  if (result.kind === 'network') return 'network';
  if (result.kind === 'aborted') return 'failed';
  const code = failureCode(result);
  if (result.status === 403 && code === WRONG_CURRENT_PASSWORD_CODE) return 'wrong_password';
  if (result.status === 401 && code !== null) return 'session_ended';
  return result.status === 400 ? 'bad_request' : 'failed';
}

/** A password change that went through: with the login the door handed, or with none. */
export type PasswordChanged = 'ok' | 'sign_in_again';

/**
 * The sentence of a password that was changed (operator ruling 358). With no login from
 * the door the browser's login is cleared: the account signs in with the new password.
 */
export function passwordChangedKey(changed: PasswordChanged): string {
  return changed === 'ok'
    ? 'publicApp.security.changePasswordSuccess'
    : 'publicApp.resetPassword.doneSignIn';
}

/** A refused request that the page says as one sentence: every answer but the two it acts on. */
export type SecurityRefusal = Exclude<SecurityAnswer, 'ok' | 'session_ended'>;

/** The sentence of a refused password change. */
export function passwordChangeRefusalKey(refusal: SecurityRefusal): string {
  if (refusal === 'wrong_password') return 'publicApp.security.errors.wrongCurrentPassword';
  if (refusal === 'network') return 'publicApp.security.errors.network';
  return 'publicApp.security.errors.changePasswordFailed';
}

/** The sentence of a refused account deletion. */
export function accountDeletionRefusalKey(refusal: SecurityRefusal): string {
  if (refusal === 'wrong_password') return 'publicApp.security.errors.wrongCurrentPassword';
  if (refusal === 'bad_request') return 'publicApp.security.errors.confirmationMismatch';
  if (refusal === 'network') return 'publicApp.security.errors.network';
  return 'publicApp.security.errors.deleteFailed';
}

/**
 * A mail with a link that sets a password (operator ruling 351): for an account that forgot
 * its password, and for one made by a mailed sign-in link, which never chose one and is still
 * asked for it. The door answers the same for every address, so `sent` says the request was
 * taken, and a failure is the request's own: a lost connection, a throttle, a server fault.
 */
export async function requestPasswordSetLink(
  apiUrl: string,
  email: string,
): Promise<'sent' | 'network' | 'failed'> {
  const result = await apiRequest(apiUrl, '/api/v1/auth/public-password-reset', {
    method: 'POST',
    body: { email },
  });
  if (result.ok) return 'sent';
  return result.kind === 'network' ? 'network' : 'failed';
}

/** The sentence of a link that was not sent. */
export function passwordSetLinkRefusalKey(refusal: 'network' | 'failed'): string {
  return refusal === 'network'
    ? 'publicApp.security.errors.network'
    : 'publicApp.security.errors.setPasswordLinkFailed';
}

export interface SecurityStatus {
  hasPassword: boolean;
  email: string | null;
}

/**
 * The page's first read. A 401 the API wrote reaches here only after `apiRequest` asked
 * `/me` to renew the login and read again: an ended session. `aborted` is the page's own
 * stop, when it closes.
 */
export async function readSecurityStatus(
  apiUrl: string,
  signal: AbortSignal,
): Promise<SecurityStatus | 'session_ended' | 'aborted' | 'failed'> {
  const result = await apiRequest<SecurityStatus>(apiUrl, '/api/v1/me/security-status', {
    signal,
  });
  if (result.ok) return result.data;
  if (result.kind === 'aborted') return 'aborted';
  const ended = result.kind === 'unauthenticated' && result.status === 401 && result.code;
  return ended ? 'session_ended' : 'failed';
}

export async function requestPasswordChange(
  apiUrl: string,
  currentPassword: string,
  newPassword: string,
): Promise<SecurityAnswer | PasswordChanged> {
  const result = await apiRequest<{ signedIn?: unknown }>(apiUrl, '/api/v1/me/change-password', {
    method: 'POST',
    body: { currentPassword, newPassword },
  });
  // The door says whether it handed a login for the new password (ruling 358).
  if (result.ok && result.data?.signedIn !== true) return 'sign_in_again';
  return answerOf(result);
}

export async function requestAccountDeletion(
  apiUrl: string,
  currentPassword: string,
  confirmation: string,
): Promise<SecurityAnswer> {
  return answerOf(
    await apiRequest(apiUrl, '/api/v1/me/account', {
      method: 'DELETE',
      body: { currentPassword, confirmation },
    }),
  );
}
