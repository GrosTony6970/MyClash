export interface GlobalPersonSuggestion {
  id: string;
  displayName: string;
  givenName: string;
  familyName: string;
  clubId: string | null;
  clubLabel: string | null;
  hemaRatingsId: string | null;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function mapGlobalPersonSuggestion(row: Record<string, unknown>): GlobalPersonSuggestion {
  const clubs = row['clubs'];
  const club =
    clubs && typeof clubs === 'object' && !Array.isArray(clubs)
      ? (clubs as Record<string, unknown>)
      : null;
  return {
    id: readString(row['id']),
    displayName: readString(row['display_name']),
    givenName: readString(row['given_name']),
    familyName: readString(row['family_name']),
    clubId: club ? readOptionalString(club['id']) : null,
    clubLabel: club ? readOptionalString(club['name']) : null,
    hemaRatingsId: readOptionalString(row['hema_ratings_id']),
  };
}
