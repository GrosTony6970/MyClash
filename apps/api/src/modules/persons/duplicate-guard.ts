/**
 * Who counts as "already on this event's roster".
 *
 * The CSV import has always answered this; the manual add path never did, so
 * the same organizer typing the same fighter twice got two rows while a CSV
 * carrying them twice got one. One rule, one place, both callers.
 *
 * ── The rule, and why it is not "match on both" ─────────────────────────────
 *
 * **An email is an identity; a name is not.** When a row carries an email, the
 * email decides on its own and the name is never consulted — two fighters
 * genuinely called Marc Dupont with different addresses are two people, and
 * refusing the second would be wrong. Only when there is no email at all does
 * the name become the best available identity, and then it decides.
 *
 * The consequence worth stating out loud: a name match is a *suspicion*, not a
 * fact. Callers that write immediately (the manual add) must let the organizer
 * override it; callers that stage a decision first (the import preview) already
 * do, by showing the row and letting them choose.
 *
 * Pure and dependency-free: the lookups belong to the caller — a Map for the
 * import, a query for the manual add — and only the judgement lives here.
 */

/** Canonical roster key for a human name. Case- and edge-whitespace-insensitive. */
export function personNameKey(givenName: string, familyName: string): string {
  return `${givenName.toLowerCase().trim()} ${familyName.toLowerCase().trim()}`;
}

/** Which identity matched, or `null` when this is a new person. */
export type DuplicateMatch = 'email' | 'name' | null;

export interface DuplicateInput {
  /** Whether the incoming row carries an email at all. */
  hasEmail: boolean;
  /** Whether that email is already on the roster. Ignored when `hasEmail` is false. */
  emailMatch: boolean;
  /** Whether the name key is already on the roster. Consulted ONLY when there is no email. */
  nameMatch: boolean;
}

export function detectDuplicate({
  hasEmail,
  emailMatch,
  nameMatch,
}: DuplicateInput): DuplicateMatch {
  if (hasEmail) return emailMatch ? 'email' : null;
  return nameMatch ? 'name' : null;
}

/** The emails and name keys of a set of people: a roster, or the rows of a file read so far. */
export interface PeopleKeys {
  emails: { has: (email: string) => boolean };
  names: { has: (nameKey: string) => boolean };
}

/**
 * Why the CSV import skips a row, by the same rule: its person was on the
 * roster before the import, or an earlier row of the same file already holds
 * them. The roster is asked first. Both the preview and the import ask here,
 * so the two screens cannot word one row two ways.
 */
export function importDuplicateReason(
  emailKey: string | undefined,
  nameKey: string,
  roster: PeopleKeys,
  earlierRows: PeopleKeys,
): 'already_on_roster' | 'repeated_in_file' | null {
  const holds = (people: PeopleKeys) =>
    detectDuplicate({
      hasEmail: Boolean(emailKey),
      emailMatch: Boolean(emailKey && people.emails.has(emailKey)),
      nameMatch: people.names.has(nameKey),
    }) !== null;
  if (holds(roster)) return 'already_on_roster';
  return holds(earlierRows) ? 'repeated_in_file' : null;
}
