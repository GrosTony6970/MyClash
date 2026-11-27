import { slugify } from '../fighters/weapon-import.util';

/**
 * The slug of a new team: its name as a slug, unique in its Tournament.
 *
 * The name's slug is `slugify`, an exported name-to-slug helper, also used by weapons admin and
 * gear (the Tournament wizard slugs its name the same way before it sends it). A slug already
 * taken gets `-2`, `-3` … A name
 * that slugs to fewer than 2 characters ("!", "A") cannot be a slug (`teams_slug_shape`, 0281:
 * `^[a-z0-9-]{2,100}$`), so the team gets the first free `team-N` instead.
 */
export function pickTeamSlug(teamName: string, taken: ReadonlySet<string>): string {
  const base = slugify(teamName);
  const candidate =
    base.length >= 2
      ? (n: number) => (n === 1 ? base : `${base}-${n}`)
      : (n: number) => `team-${n}`;
  let n = 1;
  while (taken.has(candidate(n))) n += 1;
  return candidate(n);
}
