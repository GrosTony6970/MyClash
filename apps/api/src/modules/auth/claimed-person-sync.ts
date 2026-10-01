// Types only: this is a plain function, not an injected provider, so no Nest
// metadata depends on these being value imports.
import type { Logger } from '@nestjs/common';

import type { SupabaseService } from '../supabase/supabase.service';
import { personEmailMatchesUser } from './person-email-match';

export interface ClaimedPersonSyncDeps {
  supabase: SupabaseService;
  logger: Logger;
}

export interface ClaimedPersonSyncTarget {
  userId: string;
  globalPersonId: string;
  /** The signing-in / approved account's own address. Empty claims nothing. */
  accountEmail: string | null | undefined;
}

/**
 * Propagate a global-person claim to the account's own event participant rows.
 *
 * The fighter dashboard reads `global_persons.claimed_by_user_id`, but the admin
 * Participants list reads `persons.claim_status`. The paths that link a user to
 * a global identity (autolink, the /me claim confirmation, admin approval) only
 * set `global_persons.claimed_by_user_id`, leaving the `persons` rows showing
 * "unclaimed". This back-fills them.
 *
 * ── Why the address, and not just the link (operator ruling 49(b)) ──────────
 * It used to claim EVERY unclaimed row linked to the profile, keyed on
 * `global_person_id` alone. An organiser links a roster row to any profile they
 * like, and the resolver's email tier used to link one by a LOOK-ALIKE address
 * (`m_martin@` matching `m.martin@` through `ilike`), so "linked to the profile
 * I just took" proved nothing about whose row it is: Marie's row was claimed by
 * Michel on his first sign-in, and her own claim was then refused as already
 * claimed. Only rows carrying the account's own address are claimed now — the
 * same bar `claimPersons` and `claimRefusal` use.
 *
 * The ruled cost: a linked row with no address, or with another one, stays
 * unclaimed. It is then absent from /me "My events" and from the notifications
 * keyed on the roster row. The fighter's remedy is the /me claim of that row
 * (which needs the same address); the organiser's is to put the fighter's
 * address on it.
 *
 * Reads the candidates first so the address can be compared here: `ilike` would
 * read `_` and `%` in a stored address as wildcards, which is the hole this
 * closes. The write keeps `claimed_by_user_id IS NULL` so a row claimed between
 * the read and the write is never taken from its owner.
 *
 * Best-effort: a failure is logged, never thrown — it must not block a login or
 * a claim confirmation. One owner for its callers (the sign-in autolink, the /me
 * claim confirmation, the admin approval and, through `syncRowsOfClaimedProfile`,
 * the organiser's saves), because the rule about whose rows these are has to be
 * the same at all of them.
 */
export async function syncClaimedPersonRows(
  deps: ClaimedPersonSyncDeps,
  { userId, globalPersonId, accountEmail }: ClaimedPersonSyncTarget,
): Promise<void> {
  if (!accountEmail?.trim()) {
    deps.logger.warn(
      `persons claim-status sync skipped for global_persons ${globalPersonId}: the account has no email`,
    );
    return;
  }

  try {
    const { data, error } = await deps.supabase.service
      .from('persons')
      .select('id, email')
      .eq('global_person_id', globalPersonId)
      .is('claimed_by_user_id', null);
    if (error) throw error;

    const linked = (data ?? []) as Array<{ id: string; email: string | null }>;
    const mine = linked
      .filter((row) => personEmailMatchesUser(row.email, accountEmail))
      .map((row) => row.id);
    if (mine.length < linked.length) {
      // The ruled cost, where it happens. Without this line a fighter asking
      // why an Event is missing from their /me leaves no trace in the log at
      // all: the autolink's own "linked to global_persons X" would be the last
      // thing written, and the rows deliberately held back would be invisible.
      deps.logger.log(
        `persons claim-status sync for global_persons ${globalPersonId}: claimed ${mine.length} of ${linked.length} linked rows; the rest carry another address or none`,
      );
    }
    if (mine.length === 0) return;

    const { error: updateError } = await deps.supabase.service
      .from('persons')
      .update({ claim_status: 'claimed', claimed_by_user_id: userId })
      .in('id', mine)
      .is('claimed_by_user_id', null);
    if (updateError) throw updateError;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logger.warn(
      `persons claim-status sync skipped for global_persons ${globalPersonId}: ${message}`,
    );
  }
}

/**
 * The organiser's side of the same claim (operator ruling 199): a roster row
 * saved for a fighter who already holds her profile becomes hers at once.
 *
 * The other callers run at the moment an account takes a profile, which happens
 * once. A row added, imported or given her address afterwards stayed unclaimed:
 * its Event was missing from /me "My events" and no notification keyed on the
 * roster row reached her, until she pressed "This is me" on /me.
 *
 * This asks who holds the profile, reads that account's own address and hands
 * both to the owner above, so the rows and the address rule are the same. A
 * profile nobody holds is the ordinary case and ends here, with nothing to say.
 * The address is read through `getAuthAdminUser`, the API's own door to GoTrue:
 * a CSV import asks once per row, and that door does not cross the edge.
 *
 * Best-effort, as above: a failed read is logged and never fails the organiser's
 * save, and the /me claim stays her remedy. Her own "This is me" at the same
 * moment writes the same two values, and the write above never takes a row
 * from an account that holds it.
 */
export async function syncRowsOfClaimedProfile(
  deps: ClaimedPersonSyncDeps,
  globalPersonId: string | null,
): Promise<void> {
  if (!globalPersonId) return;

  try {
    const { data, error } = await deps.supabase.service
      .from('global_persons')
      .select('claimed_by_user_id')
      .eq('id', globalPersonId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const userId = (data as { claimed_by_user_id: string | null } | null)?.claimed_by_user_id;
    if (!userId) return;

    const account = await deps.supabase.getAuthAdminUser(userId);
    if (!account.ok) throw new Error(`the account read answered ${account.status}`);
    await syncClaimedPersonRows(deps, {
      userId,
      globalPersonId,
      accountEmail: account.data?.email,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logger.warn(
      `persons claim-status sync skipped for global_persons ${globalPersonId}: ${message}`,
    );
  }
}
