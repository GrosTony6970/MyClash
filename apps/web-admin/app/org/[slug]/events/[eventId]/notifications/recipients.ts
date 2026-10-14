import { fuzzyMatch } from '@myclash/ui';

/** The server takes this many people in one message, no more (`notifications.dto.ts`). */
export const MAX_RECIPIENTS = 500;

export interface Recipient {
  id: string;
  givenName: string;
  familyName: string;
  email: string;
  clubLabel: string | null;
}

/** The people a search shows: name, email or club, accents and case ignored (O5). */
export function shownPeople<T extends Recipient>(people: T[], query: string): T[] {
  return people.filter((person) =>
    fuzzyMatch(
      query,
      `${person.givenName} ${person.familyName} ${person.email} ${person.clubLabel ?? ''}`,
    ),
  );
}

/** "Select all shown" adds to what is already picked (O5, ruled 2026-10-14). */
export function withShown(picked: ReadonlySet<string>, shown: Recipient[]): Set<string> {
  return new Set([...picked, ...shown.map((person) => person.id)]);
}

/** How many of the picked people the search hides. */
export function hiddenPicked(picked: ReadonlySet<string>, shown: Recipient[]): number {
  const visible = new Set(shown.map((person) => person.id));
  return [...picked].filter((id) => !visible.has(id)).length;
}
