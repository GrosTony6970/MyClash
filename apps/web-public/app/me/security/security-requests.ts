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
): Promise<SecurityAnswer> {
  return answerOf(
    await apiRequest(apiUrl, '/api/v1/me/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    }),
  );
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
