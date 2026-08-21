import { BadRequestException } from '@nestjs/common';
import type { SupabaseService } from '../supabase/supabase.service';
import type { RosterPersonRow } from './roster';

/**
 * The roster as an event-day desk sees it — shared by check-in and gear check.
 *
 * One owner because both desks answer the same question first ("who is this
 * person in front of me?") and must answer it identically: the photo and club
 * that let a volunteer tell two similar names apart are worth nothing if the
 * two screens resolve them differently.
 *
 * ── The whole event, once ───────────────────────────────────────────────────
 * This used to take a search term and cap the answer at 40 rows, because the
 * desk searched over the wire on every keystroke. It no longer does: both desks
 * fetch the roster once and then search, filter and count it in the browser, so
 * that a tab reading "Not arrived (63)" has 63 rows behind it. Filtering here
 * as well would put the counting and the list on two different answers.
 */

/**
 * How many people one desk screen will hold.
 *
 * A ceiling rather than a page: there is no "next page" on a desk screen, so
 * anything past this is invisible, and invisible truncation would make every
 * tab count a lie. `truncated` says so out loud instead.
 */
export const ROSTER_LIMIT = 1000;

/** The roster, and whether the ceiling cut it short. */
export interface RosterPage {
  people: RosterPersonRow[];
  truncated: boolean;
}

export async function queryEventRoster(
  supabase: SupabaseService,
  eventId: string,
  /**
   * Injectable so `truncated` is reachable in a test. At 1000 no fixture anyone
   * will build can make the flag fire, and a branch no test can reach is a
   * branch nobody has ever run.
   */
  limit = ROSTER_LIMIT,
  /**
   * Restrict to specific people, for the QR lane: a scanned token names one
   * person and the overlay still needs the photo and club the roster shows.
   * Kept as a parameter of THIS function rather than a second query so the
   * select literal stays in one place — which matters twice over, because
   * `db-schema-conformance.test.ts` reads (table, column) pairs off the literal
   * at its call site and a hoisted or duplicated one goes unchecked.
   */
  personIds?: readonly string[],
): Promise<RosterPage> {
  let query = supabase.service
    .from('persons')
    .select(
      'id,given_name,family_name,club_id,global_person_id,clubs(name,logo_url),global_persons(photo_url)',
    )
    .eq('event_id', eventId)
    .order('family_name', { ascending: true })
    // One past the ceiling: the extra row is how we know the event has more
    // people than this screen can show, and it is dropped below.
    .limit(limit + 1);

  if (personIds) query = query.in('id', [...personIds]) as unknown as typeof query;

  const { data, error } = await query;
  if (error) throw new BadRequestException(error.message);

  const rows = (data ?? []) as unknown as RosterPersonRow[];
  return { people: rows.slice(0, limit), truncated: rows.length > limit };
}
