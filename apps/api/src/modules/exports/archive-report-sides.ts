/**
 * archive-report-sides.ts — how the archive's CSV reports key and name a side of a bout.
 *
 * A side is a Registration or a team (ADR-022). The snapshot holds both columns on every bout, so
 * the reports key a side with `sideKey` and name it through `sideLabel`.
 */
import { sideKey } from '@myclash/types/side-key';
import { unknownFighterInEnglish } from '../../common/unknown-name';
import { sideLabel } from '../matches/side-label';
import type { ArchiveRow } from './archive.types';

/** The key of one side of a bout row: its Registration or its team, never both. */
export function boutSideKey(match: ArchiveRow, side: 'red' | 'blue'): string | null {
  return sideKey(
    match[`${side}_registration_id`] as string | null | undefined,
    match[`${side}_team_id`] as string | null | undefined,
  );
}

/** The key of the winner of a bout row: its Registration or its team, null when none won. */
export function winnerSideKey(match: ArchiveRow): string | null {
  return sideKey(
    match['winner_registration_id'] as string | null | undefined,
    match['winner_team_id'] as string | null | undefined,
  );
}

/** What the reports read to name a side. */
export interface SideNames {
  registrations: ArchiveRow[];
  persons: ArchiveRow[];
  /** The Tournament's own teams. */
  teams: ArchiveRow[];
}

/**
 * The name of one side, through `sideLabel` (the one owner): a team by its name, a Fighter by
 * `registrationName`. An empty cell when the side is not known or its team is not in the archive.
 */
export function sideName(registrationId: unknown, teamId: unknown, names: SideNames): string {
  const key = sideKey(
    typeof registrationId === 'string' ? registrationId : null,
    typeof teamId === 'string' ? teamId : null,
  );
  if (key === null) return '';
  if (typeof teamId !== 'string') return registrationName(key, names.registrations, names.persons);
  const team = names.teams.find((row) => row['id'] === key);
  if (!team) return '';
  return sideLabel(null, {
    id: key,
    name: String(team['name'] ?? ''),
    color: null,
    logo_url: null,
  }).name;
}

/**
 * The fighter's name, or "Unknown fighter (bib 12)" when the archive holds no name for them:
 * never the registration id (operator ruling, X2, 2026-10-15). The machine-readable CSVs of the
 * same archive keep the ids, so a row can still be looked up there.
 */
function registrationName(
  registrationId: unknown,
  registrations: ArchiveRow[],
  persons: ArchiveRow[],
): string {
  if (typeof registrationId !== 'string') return '';
  const registration = registrations.find((row) => row['id'] === registrationId);
  const person = persons.find((row) => row['id'] === registration?.['person_id']);
  const name = `${(person?.['given_name'] as string | null) ?? ''} ${(person?.['family_name'] as string | null) ?? ''}`;
  if (name.trim()) return name.trim();
  const bib = registration?.['bib_number'];
  return unknownFighterInEnglish(typeof bib === 'number' ? bib : null);
}
