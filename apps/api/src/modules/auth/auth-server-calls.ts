import { Logger, UnauthorizedException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { classifyGoTrueFailure } from '../supabase/gotrue-failure';
import { GOTRUE_TIMEOUT_MS } from '../supabase/supabase.service';

const logger = new Logger('AuthServerCalls');

/** The auth server refused a mailed link's code: the link is dead (operator ruling 362). */
export class MailedCodeRefused extends UnauthorizedException {
  constructor() {
    super('Invalid or expired magic link');
  }
}

/**
 * The auth server gave no judgment of a mailed code (operator ruling 360). The
 * code is not spent: a door a browser reached by a link says "open it again".
 */
export class MailedCodeUnjudged extends Error {}

/**
 * The calls of the password doors and of the mailed-link doors that reach the
 * auth server through supabase-js, each held to the limit of the API's other
 * calls to it (operator ruling 360).
 *
 * supabase-js takes no signal, so a call is raced against the limit. The answer
 * that comes late is dropped; the request itself is not stopped, and the auth
 * server may still do what was asked.
 */
function heldToLimit<T>(call: PromiseLike<T>): Promise<T> {
  const limit = AbortSignal.timeout(GOTRUE_TIMEOUT_MS);
  const ranOut = new Promise<never>((_resolve, reject) => {
    limit.addEventListener('abort', () => {
      reject(new Error('The auth server gave no answer in time'));
    });
  });
  return Promise.race([call, ranOut]);
}

/** The doors' one trace of a code nobody judged: a door that redirects reports no 5xx. */
function unjudged(why: string, cause: unknown): MailedCodeUnjudged {
  logger.warn(`The auth server did not judge a mailed code: ${why}`);
  return new MailedCodeUnjudged(`The auth server did not judge a mailed code: ${why}`, { cause });
}

/**
 * Spend the code of a mailed link. Null: the auth server REFUSED the code. It
 * answers a 403 for a code that is made up, used or past its life (read on
 * GoTrue v2.195.0). A throttle, a server fault or no answer is no judgment of
 * the code: a plain Error, so no page says "expired" over a link nobody judged.
 */
export async function spendMailedCode(
  anon: SupabaseClient,
  tokenHash: string,
  type: 'email' | 'recovery',
) {
  const asked = anon.auth.verifyOtp({ token_hash: tokenHash, type });
  const { data, error } = await heldToLimit(asked).catch((ranOut: Error) => {
    throw unjudged(ranOut.message, ranOut);
  });
  if (!error) return data;
  // supabase-js hands no status, or 0, for an answer it could not read or never got.
  if (!error.status || classifyGoTrueFailure(error.status) === 'unavailable') {
    throw unjudged(error.message, error);
  }
  return null;
}

/** Write an account's password. */
export function writePassword(service: SupabaseClient, userId: string, password: string) {
  return heldToLimit(service.auth.admin.updateUserById(userId, { password }));
}

/** Remove an account from the auth server. */
export function removeAccount(service: SupabaseClient, userId: string) {
  return heldToLimit(service.auth.admin.deleteUser(userId));
}
