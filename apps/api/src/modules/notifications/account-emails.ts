/**
 * account-emails.ts — the own addresses of many accounts, in one call (operator ruling 215).
 *
 * A notice that goes to an account is mailed to that account's own address, not to the address
 * of a roster row: a follower may be on no roster, and an organiser may have typed the row's.
 * One account is read through GoTrue (`SupabaseService.getAuthAdminUser`, as the lock message
 * does). Many are not: GoTrue lists accounts by page, never by a list of ids. So this calls the
 * database function `account_emails` (migration 0217), which only the service role may run.
 *
 * Best effort, on purpose: a notice is still worth sending to a phone when its address cannot be
 * read. A failed read is logged and answers no address; it never fails the sender. The cost: the
 * worker mails an account when it sends it no push (most often: no push subscription), so after
 * a failed read those accounts are told nothing, and a sender that runs once (the new-Event
 * notice) never tells them.
 */
import type { Logger } from '@nestjs/common';
import type { SupabaseService } from '../supabase/supabase.service';

export interface AccountEmailsDeps {
  supabase: SupabaseService;
  logger: Pick<Logger, 'warn'>;
}

/**
 * The address of each account that has one, by account id. `what` names the notice in the log.
 * An account with no address, or that no longer exists, has no entry.
 */
export async function accountEmails(
  deps: AccountEmailsDeps,
  userIds: string[],
  what: string,
): Promise<Map<string, string>> {
  const emails = new Map<string, string>();
  if (userIds.length === 0) return emails;

  // The ids travel in the request body, so the list is not bounded by a URL.
  const { data, error } = await deps.supabase.service.rpc('account_emails', {
    p_user_ids: userIds,
  });
  if (error) {
    deps.logger.warn(`${what}: account addresses unreadable: ${error.message}`);
    return emails;
  }
  for (const row of (data ?? []) as Array<{ user_id: string; email: string | null }>) {
    if (row.email) emails.set(row.user_id, row.email);
  }
  return emails;
}
