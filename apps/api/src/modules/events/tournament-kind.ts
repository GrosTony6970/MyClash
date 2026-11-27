import { BadRequestException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A Tournament's kind of entrant (`tournaments.entrant_kind`, migration 0281): individual Fighters
 * (Registrations) or teams. The rules a create or a save checks against the kind IN FORCE — the
 * body's when it sends one, else the stored one — and the columns a change of kind clears.
 *
 * - A team Tournament has no waitlist: a non-null `maxWaitlist` is refused (null is accepted, the
 *   settings Basics save sends it).
 * - A team Tournament takes no forfeit rules: ruling 972 governs a team's cards, so any
 *   `forfeitRules` is refused. The stored rules stay, unread.
 * - An individual Tournament has no team size: a non-null `teamDefaultSize` is refused.
 * - A switch to team clears `max_waitlist`; a switch to individual clears `team_default_size`.
 *
 * Whether the kind may change at all is the database's (`entrant_kind_is_settled`, and
 * `entrant_kind_set_before_phases` since ruling 989): the save is refused 409 once the Tournament
 * holds an entrant or has a phase (`entrantKindRefusal`).
 *
 * THE RACE, accepted: save A sends `maxWaitlist: 6` and is judged against the stored `individual`;
 * meanwhile save B switches the empty Tournament to `team` (and clears `max_waitlist`). If A writes
 * last, its cap lands on a team Tournament: the trigger judges entrants, not `max_waitlist` or
 * `forfeit_rules`, and these checks read the row before the write. The impact is small: no waitlist
 * row can ever be inserted there (a Registration of a team Tournament is refused by the trigger),
 * and the stray cap shows only in the overview (the Tournament's row and the waitlist total). A
 * forfeit rules change that lands the same way is stored and never read on a team Tournament.
 * Accepted because both saves come from the club's own admins on a Tournament with no entrant, the
 * damage is a number no write acts on, and any save that sends `maxWaitlist: null` clears it;
 * closing it would need a write conditional on `entrant_kind`, or a trigger over two more columns.
 *
 * A Side's kind is another word on purpose (ruling 1006): `registration` or `team` (`NamedSide`,
 * `matches/named-side.ts`), because a Side IS a Registration or a Team (`docs/HIERARCHY.md`) and a
 * Tournament IS individual or team (ADR-022). That word is for a side a request body names. The
 * side shapes the wire sends (`BracketSideWire.kind`, `PoolStandingsRow.kind`, `SideSeat.kind`)
 * carry the Tournament's word, `individual` or `team`.
 */
export type EntrantKind = 'individual' | 'team';

/** The fields of a create or a save the kind judges. */
export interface KindFields {
  entrantKind?: EntrantKind;
  teamDefaultSize?: number | null;
  maxWaitlist?: number | null;
  forfeitRules?: unknown;
}

const refused = (field: string, message: string) =>
  new BadRequestException({ code: 'entrant_kind_field', field, message });

/** Throws 400 when `body` sends what a Tournament of `kind` refuses. */
export function assertFitsKind(kind: EntrantKind, body: KindFields): void {
  if (kind === 'team') {
    if (body.maxWaitlist != null) {
      throw refused('maxWaitlist', 'A team Tournament has no waitlist.');
    }
    if (body.forfeitRules !== undefined) {
      throw refused('forfeitRules', 'The forfeit rules do not act on a team Tournament.');
    }
  } else if (body.teamDefaultSize != null) {
    throw refused('teamDefaultSize', 'An individual Tournament has no team size.');
  }
}

/**
 * The kind a read Tournament row holds (`tournaments.entrant_kind`, NOT NULL since 0281). Throws on
 * anything else: a read whose select left the column out, or found no row, must not pass for an
 * individual Tournament. In a team Pool that would write seats and bouts into the Registration
 * columns, all null. The save path keeps `kindInForce`, whose body may send no kind.
 */
export function storedKind(value: unknown): EntrantKind {
  if (value === 'team' || value === 'individual') return value;
  throw new Error(`The Tournament's kind was not read (entrant_kind is ${String(value)})`);
}

/** The kind in force for a save: the body's, else the stored one. */
export const kindInForce = (stored: unknown, body: KindFields): EntrantKind =>
  body.entrantKind ?? (stored === 'team' ? 'team' : 'individual');

/**
 * The kind columns a save of a Tournament stored as `stored` writes: what the body sends, and the
 * clears of a change of kind.
 */
export function kindColumnsOfSave(stored: unknown, body: KindFields): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  if (body.entrantKind !== undefined) columns['entrant_kind'] = body.entrantKind;
  if (body.teamDefaultSize !== undefined) columns['team_default_size'] = body.teamDefaultSize;
  if (body.entrantKind === undefined || body.entrantKind === stored) return columns;
  if (body.entrantKind === 'team') columns['max_waitlist'] = null;
  else columns['team_default_size'] = null;
  return columns;
}

/**
 * How many entrants the Tournament holds: every Registration whatever its status, plus every team.
 * Exactly what the kind trigger counts (`entrant_kind_is_settled`, 0281): above zero, the kind is
 * fixed, and the screens say so before a save is refused.
 */
export async function countTournamentEntrants(
  db: SupabaseClient,
  tournamentId: string,
): Promise<number> {
  const answers = await Promise.all(
    ['registrations', 'teams'].map((table) =>
      db.from(table).select('id', { count: 'exact', head: true }).eq('tournament_id', tournamentId),
    ),
  );
  let total = 0;
  for (const { count, error } of answers) {
    if (error) throw new BadRequestException(error.message);
    total += count ?? 0;
  }
  return total;
}
