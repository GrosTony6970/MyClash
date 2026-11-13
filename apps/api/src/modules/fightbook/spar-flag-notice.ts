import type { SupabaseClient } from '@supabase/supabase-js';
import { sparFlagRaised } from '../notifications/notice-texts/notice-texts';
import { rolesAtLeast } from '../organizations/organizations.service';
import type { SparNoticeDeps } from './spar-notices';

type FlagNoticeDeps = Omit<SparNoticeDeps, 'db'> & {
  db: Pick<SupabaseClient, 'rpc'>;
  /** The site's domain, from the same `DOMAIN` setting as every mailed link. */
  domain: string;
};

interface Recipient {
  user_id: string;
  audience: 'club' | 'platform';
  org_slug: string | null;
}

/**
 * The alert of a new safety flag (rulings 692, 698): to the club's admins and owners, or to the
 * super admins when the flag has no club. `fightbook_flag_recipients` picks them and never picks
 * the reporter's own accounts or the fighter flagged. The notice names no one and no reason: it
 * can show on a locked phone. It goes like any notice: a push to a phone that is set up, else an
 * email. It also passes the main switch (`PASSES_MAIN_SWITCH`): a reader whose main switch is off
 * gets it by email, without a buzz. No `preference`, since the `fightbook` switch is the fighter's
 * own.
 *
 * Never throws: the flag is saved before this is called and the caller does not wait for it. A
 * failed read or send is logged with the flag id, never a name. So is an alert that reaches no one
 * (no recipient) or may not (an account with no email address).
 */
export async function notifySparFlagRaised(d: FlagNoticeDeps, flagId: string): Promise<void> {
  try {
    const { data, error } = await d.db.rpc('fightbook_flag_recipients', {
      p_flag: flagId,
      p_roles: rolesAtLeast('admin'),
    });
    if (error) throw new Error(`recipients unreadable: ${error.message}`);
    const rows = (data ?? []) as Recipient[];
    if (rows.length === 0) d.logger.warn(`FightBook flag ${flagId}: the alert has no recipient`);
    for (const row of rows) await alertOne(d, flagId, row);
  } catch (cause) {
    logFailure(d, flagId, cause);
  }
}

/** One recipient: a failure here is theirs alone, the others still get the alert. */
async function alertOne(d: FlagNoticeDeps, flagId: string, row: Recipient): Promise<void> {
  try {
    const { status, data: account } = await d.supabase.getAuthAdminUser(row.user_id);
    if (!account) d.logger.warn(`FightBook flag ${flagId}: account unreadable: ${status}`);
    else if (!account.email)
      d.logger.warn(`FightBook flag ${flagId}: a recipient has no email, push only`);
    await d.notifications.sendImmediate({
      kind: 'spar_flag_raised',
      entityId: flagId,
      userId: row.user_id,
      email: account?.email ?? null,
      ...sparFlagRaised(),
      url: flagUrl(d.domain, row),
    });
  } catch (cause) {
    logFailure(d, flagId, cause);
  }
}

function flagUrl(domain: string, row: Recipient): string {
  const admin = `https://admin.${domain}`;
  if (row.audience === 'platform') return `${admin}/admin/fightbook-flags`;
  // A club admin has no door to the platform page: a club row without a slug is an error, logged.
  if (!row.org_slug) throw new Error('a club recipient came without a club slug');
  return `${admin}/org/${row.org_slug}/fightbook-flags`;
}

function logFailure(d: FlagNoticeDeps, flagId: string, cause: unknown): void {
  const reason = cause instanceof Error ? cause.message : String(cause);
  d.logger.error(`FightBook flag ${flagId}: the alert was not sent: ${reason}`);
}
