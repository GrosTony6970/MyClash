/** The name columns of a `global_persons` row, as a referee roster read selects them. */
export interface RosterPersonName {
  given_name: string | null;
  family_name: string | null;
  display_name: string | null;
}

/**
 * A referee's name as the Event's referee roster shows it: given and family name, else the
 * display name. Blank when no name is known: a screen words that, never the id. The roster
 * (`listEventReferees`), and so the MCP referee tools, and a draft's names share this rule.
 */
export function rosterDisplayName(person: RosterPersonName | null): string {
  if (!person) return '';
  const full = `${person.given_name ?? ''} ${person.family_name ?? ''}`.trim();
  return full || (person.display_name ?? '').trim();
}
