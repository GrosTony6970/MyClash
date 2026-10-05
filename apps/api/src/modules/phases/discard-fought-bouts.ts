import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { ExchangeEditRequestRow, FrozenResultsGuard } from '../matches/frozen-results.guard';
import type { OrganizationsService } from '../organizations/organizations.service';
import type { SupabaseService } from '../supabase/supabase.service';

/**
 * A door that deletes a whole phase, and its fought bouts with it.
 *
 * Three doors do: the forced "generate Pools again", "Regenerate bracket" and
 * "Delete bracket". The delete of the phase row cascades to its bouts, and from
 * each bout to its exchanges, cards, events, forfeits and referee duties: there
 * is nothing left to recover a result from. So when a bout of the phase reads
 * as fought, the loss is the organisation OWNER's to accept (ruling 279), on
 * each door alike.
 *
 * "Reads as fought" is `PhasesService.scoredMatchesIn`: the bout's STATUS is
 * running, paused or completed. The bar is as wide as that predicate, no
 * wider: a voided bout keeps its hits and does not count. The status route
 * no longer sets a bout back to `scheduled` (ruling 281).
 */

/** The 409 of the three doors: fought bouts would go, and the yes did not name their count. */
export const SCORED_BOUTS_WOULD_BE_DISCARDED = 'scored_bouts_would_be_discarded';
/** An admin asked for it. The screens say this one in the reader's language. */
export const DISCARD_REQUIRES_OWNER = 'discard_requires_owner';

/**
 * Only the owner of the organisation discards fought bouts.
 *
 * Fails CLOSED on a missing actor or a missing organisation: the door exists to
 * let a named human accept a permanent loss, and "we could not work out who you
 * are" is not that. A refusal of the membership check becomes the coded one
 * (each door has asked for an admin by then, so it is the role's); a failed
 * membership read stays an error, never "you are not the owner".
 */
export async function assertOwnerDiscards(
  orgs: OrganizationsService | undefined,
  organizationId: string | null,
  userId: string | undefined,
): Promise<void> {
  if (!orgs) throw new BadRequestException('Organizations service not wired');
  if (!userId || !organizationId) {
    throw new ForbiddenException(
      'Discarding scored results requires an identified organisation owner.',
    );
  }
  try {
    await orgs.assertOrgRole(organizationId, userId, 'owner');
  } catch (cause) {
    if (!(cause instanceof ForbiddenException)) throw cause;
    throw new ForbiddenException({
      message: 'Only the owner of the organisation can delete bouts that have been fought.',
      code: DISCARD_REQUIRES_OWNER,
    });
  }
}

/**
 * Delete a phase, and end the correction requests that wait on its bouts
 * (rulings 276, 277).
 *
 * A request names a hit of a bout, and goes with the bout (`ON DELETE CASCADE`,
 * migration 0014): who asked would be told nothing. So the requests are closed
 * BEFORE the delete, by the owner of that close (`closeResetRequests`: the
 * update names `status = pending`, so a request a review closed a moment ago is
 * not told twice), and who asked is told once the delete has run. The audit
 * line of each close outlives the row.
 *
 * Every bout of the phase is named, not only the fought ones: a request can
 * wait on a voided hit of a bout that reads unplayed.
 *
 * Told in a `finally`: the close is saved by then, and a retry closes nothing.
 * The delete is checked: unchecked, a phase that stayed read as a phase that
 * went, and the generation that follows met its bouts.
 */
export async function deletePhaseWithItsRequests(
  deps: { supabase: SupabaseService['service']; frozenResults?: FrozenResultsGuard },
  phaseId: string,
  userId: string | undefined,
): Promise<void> {
  const bouts = await deps.supabase.from('matches').select('id').eq('phase_id', phaseId);
  if (bouts.error) {
    throw new Error(`Could not read the bouts of phase ${phaseId}: ${bouts.error.message}`);
  }
  const boutIds = ((bouts.data ?? []) as Array<{ id: string }>).map((bout) => bout.id);

  // The close names its bouts in the URL, and never throws: past the limit it
  // would close nothing in silence, and the cascade would then take the requests.
  const closed: ExchangeEditRequestRow[] = [];
  for (let i = 0; i < boutIds.length; i += IN_CHUNK) {
    const chunk = boutIds.slice(i, i + IN_CHUNK);
    const rows = await deps.frozenResults?.rejectPendingEditsForMatch(chunk, userId, BOUT_DELETED);
    closed.push(...(rows ?? []));
  }
  try {
    const { error } = await deps.supabase.from('phases').delete().eq('id', phaseId);
    if (error) throw new BadRequestException(error.message);
  } finally {
    await deps.frozenResults?.tellClosedByReset(closed);
  }
}

/** PostgREST puts `.in()` values in the URL; a Pool phase can hold several hundred bouts. */
const IN_CHUNK = 200;
const BOUT_DELETED = 'bout_deleted';
