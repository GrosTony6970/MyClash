/**
 * Slice 3b — case-insensitive substring filter for the public participants
 * page. Matches against the display name + club name + club abbreviation.
 * Trims whitespace; empty queries return the full list.
 *
 * Kept dependency-free so the helper can be unit-tested in isolation.
 */

export interface ParticipantLike {
  personId: string;
  displayName: string;
  clubName: string | null;
  clubAbbrev: string | null;
  tournaments: Array<{
    id: string;
    slug: string;
    name: string;
    color: string | null;
    registrationState: 'active' | 'pending';
  }>;
}

export function filterParticipants<T extends ParticipantLike>(
  participants: T[],
  rawQuery: string,
): T[] {
  const needle = rawQuery.trim().toLowerCase();
  if (needle === '') return participants;
  return participants.filter((p) => {
    const haystack = [p.displayName, p.clubName, p.clubAbbrev]
      .filter((v): v is string => typeof v === 'string')
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
}
