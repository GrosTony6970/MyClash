import { fuzzyMatch } from '@myclash/ui';

/**
 * Which bouts of a Pool the bouts tab shows (quick win O29, ruled 2026-10-14). The filter
 * matches the two fighters, their clubs and the referees, accents ignored, every word
 * somewhere in the bout. "Hide completed" hides the completed and the voided bouts.
 */
export interface FilterableBout {
  red_name: string;
  blue_name: string;
  red_club_abbrev: string | null;
  blue_club_abbrev: string | null;
  referees: ReadonlyArray<{ refereeName: string }>;
  status: string;
}

const DONE = new Set(['completed', 'voided']);

export function matchVisible(bout: FilterableBout, query: string, hideDone: boolean): boolean {
  if (hideDone && DONE.has(bout.status)) return false;
  const words = [
    bout.red_name,
    bout.red_club_abbrev ?? '',
    bout.blue_name,
    bout.blue_club_abbrev ?? '',
    ...bout.referees.map((referee) => referee.refereeName),
  ];
  return fuzzyMatch(query, words.join(' '));
}
