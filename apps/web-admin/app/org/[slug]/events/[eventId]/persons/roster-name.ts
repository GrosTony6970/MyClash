/**
 * Roster display name: family name first (upper-cased), then given name —
 * e.g. "ADRIEN Thomas". Matches the participant list's family-name sort and
 * the common roster convention. Tolerant of a missing given or family part.
 */
export function formatRosterName({
  familyName,
  givenName,
}: {
  familyName: string;
  givenName: string;
}): string {
  const family = familyName.trim();
  const given = givenName.trim();
  return [family ? family.toUpperCase() : '', given].filter(Boolean).join(' ');
}
