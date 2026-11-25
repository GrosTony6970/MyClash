import type { ApiFailure } from '@myclash/api-client';
import { conflictReason } from '@/lib/named-refusal';

/**
 * A Tournament's kind of entrant (`tournaments.entrant_kind`, migration 0281): individual Fighters
 * or teams. What the creator's Step 1 and the settings Basics tab read of it, and what their saves
 * send. The API's rules are `apps/api/src/modules/events/tournament-kind.ts`.
 */
export type EntrantKind = 'individual' | 'team';

/** The kind of a Tournament row (`GET /tournaments/:id`), its team size and its entrants. */
export interface KindOfRow {
  kind: EntrantKind;
  /** The size a new team takes when none is given; null for none. */
  teamDefaultSize: number | null;
  /** Registrations plus teams: above zero the kind is fixed (`entrant_kind_is_settled`). */
  entrantCount: number;
}

export function kindOfRow(row: Record<string, unknown>): KindOfRow {
  return {
    kind: row['entrant_kind'] === 'team' ? 'team' : 'individual',
    teamDefaultSize: (row['team_default_size'] as number | null | undefined) ?? null,
    entrantCount: (row['entrant_count'] as number | undefined) ?? 0,
  };
}

/**
 * A save's body, fitted to the kind. A team Tournament has no waitlist and takes no forfeit rules,
 * so the form hides both and the body leaves both out: a hidden field is not sent. It sends its
 * default team size. The kind is sent only when it differs from `storedKind`, as `patchOf` sends
 * only the forfeit rules changed: a save made from a stale screen cannot set the kind back, an
 * individual body stays the one it always was, and a closed choice (the Tournament holds
 * entrants) never differs. A create's stored kind is the server's default, individual.
 */
export function bodyForKind(
  body: Record<string, unknown>,
  kind: EntrantKind,
  teamDefaultSize: number | null,
  storedKind: EntrantKind,
): Record<string, unknown> {
  const sent = kind !== storedKind ? { entrantKind: kind } : {};
  if (kind === 'individual') return { ...body, ...sent };
  const { maxWaitlist: _maxWaitlist, forfeitRules: _forfeitRules, ...rest } = body;
  return { ...rest, ...sent, teamDefaultSize };
}

/** A number field's text as the API takes it: blank is none (no cap, no default size). */
export const numberOrNull = (text: string): number | null => (text ? Number(text) : null);

/** A number as its field's text: none is blank. */
export const textOf = (value: number | null): string => (value == null ? '' : String(value));

/**
 * The sentence for a save refused because the Tournament gained an entrant since the page read it:
 * its kind is fixed now (409, `details.reason: entrant_kind_settled`). Null for any other refusal.
 */
export function kindSettledRefusal(r: ApiFailure, t: (key: string) => string): string | null {
  return conflictReason(r) === 'entrant_kind_settled'
    ? t('organizer.tournaments.kind.settled')
    : null;
}
