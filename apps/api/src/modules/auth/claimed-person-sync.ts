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
 * An organiser's save that leaves a claimed roster row with an address that is
 * not its holder's account address frees the row (operator rulings 203, 203a).
 *
 * An organiser adds Tom and types Léa's address by mistake. Léa has an account,
 * so the row becomes hers: at once (ruling 199), or at her next sign-in. The
 * organiser corrects the address, or deletes it. Nothing gave the row back: it
 * stayed Léa's, Tom's claim was refused, and only deleting Léa's account freed
 * it.
 *
 * The saved address is compared with the holder's account address. No address
 * is not her address either (203a). The ruled cost: swapping a fighter's
 * address for another one of hers frees her row too. Once the row carries her
 * account's address again she is linked again: at that save when the row is
 * linked to the profile she holds (`syncRowsOfClaimedProfile` runs next), and
 * otherwise by the "This is me" card on /me.
 *
 * The other writers keep a claimed row at its holder's address: a claim needs
 * the match, and an account address change rewrites the rows (204). So this
 * is asked at the organiser's save only.
 *
 * The write names the holder that was read: a row that changed hands in between
 * is left alone. It does not name the address: a second save of the same row
 * landing between the read and the write is judged on the first one's address.
 * Best-effort, as the sync: an account that cannot be read frees nothing, is
 * logged, and never fails the organiser's save. A holder whose account is gone
 * answers 404 and is kept too: deleting an account frees its rows itself.
 */
export async function freeRowOfAnotherAddress(
  deps: ClaimedPersonSyncDeps,
  row: { id: string; email: string | null; claimed_by_user_id: string | null },
): Promise<void> {
  const holder = row.claimed_by_user_id;
  if (!holder) return;

  try {
    const account = await deps.supabase.getAuthAdminUser(holder);
    if (!account.data) throw new Error(`the account read answered ${account.status}`);
    if (!account.data.email?.trim()) throw new Error('the account has no email');
    if (personEmailMatchesUser(row.email, account.data.email)) return;

    const { error } = await deps.supabase.service
      .from('persons')
      .update({ claim_status: 'unclaimed', claimed_by_user_id: null })
      .eq('id', row.id)
      .eq('claimed_by_user_id', holder);
    if (error) throw new Error(error.message);
    deps.logger.log(`persons ${row.id} freed from its account: its address is not the account's`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logger.warn(`persons ${row.id} not freed: ${message}`);
  }
}

/**
 * An account's address changed: the roster rows it holds take the new one
 * (operator ruling 204).
 *
 * A claimed row carries its holder's account address: a claim needs that match
 * when it is made. So both of the API's doors that change an account's address
 * come here: the fighter's own change, and a platform admin's on the Accounts
 * page. The admin's used to leave the rows behind, and the emails of her
 * notices went to the old address.
 *
 * One write for all her rows: ask `addressTakenOnHerRosters` BEFORE the account
 * changes. Hands back the write's error: each caller decides what a failure
 * means.
 */
export async function moveClaimedRowsToAddress(
  supabase: SupabaseService,
  userId: string,
  email: string,
): Promise<{ message: string } | null> {
  const { error } = await supabase.service
    .from('persons')
    .update({ email, updated_at: new Date().toISOString() })
    .eq('claimed_by_user_id', userId);
  return error;
}

/**
 * Whether a roster this account is on already has the address on ANOTHER row.
 *
 * A roster cannot hold one address twice (`persons_event_id_email_key`), and
 * the move above is one write: a taken address in one Event would move none of
 * her rows, after the account itself has changed. So both doors ask first and
 * refuse the change whole.
 *
 * The read narrows with `ilike` and the comparison is made here: `ilike` reads
 * `_` and `%` in an address as wildcards, and a look-alike is not a taken
 * address. A failed read throws: it says nothing about the address.
 */
export async function addressTakenOnHerRosters(
  supabase: SupabaseService,
  userId: string,
  email: string,
): Promise<boolean> {
  const held = await supabase.service
    .from('persons')
    .select('id, event_id')
    .eq('claimed_by_user_id', userId);
  if (held.error) throw new Error(`Roster rows of ${userId} unreadable: ${held.error.message}`);
  const hers = (held.data ?? []) as Array<{ id: string; event_id: string }>;
  if (hers.length === 0) return false;

  const same = await supabase.service
    .from('persons')
    .select('id, email')
    .in('event_id', [...new Set(hers.map((row) => row.event_id))])
    .ilike('email', email);
  if (same.error) throw new Error(`Roster address read failed: ${same.error.message}`);
  const herIds = new Set(hers.map((row) => row.id));
  return ((same.data ?? []) as Array<{ id: string; email: string | null }>).some(
    (row) => !herIds.has(row.id) && personEmailMatchesUser(row.email, email),
  );
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
