/**
 * Fighter-profile fields a user can hide from their public profile, mapped to
 * the underlying column(s). `defaultPublic: false` means hidden unless the user
 * opts in (date_of_birth stays private by default, preserving prior behaviour).
 *
 * The one owner: the fighter profile and the People hub's cards both read it.
 */
export const VISIBILITY_FIELDS = {
  dateOfBirth: { columns: ['date_of_birth'], defaultPublic: false },
  nationality: { columns: ['country_code'], defaultPublic: true },
  gender: { columns: ['gender_category'], defaultPublic: true },
  bio: { columns: ['bio'], defaultPublic: true },
  alias: { columns: ['alias'], defaultPublic: true },
  links: { columns: ['website_url', 'instagram_url', 'youtube_url'], defaultPublic: true },
  practicingSince: { columns: ['practicing_since_year'], defaultPublic: true },
} as const satisfies Record<string, { columns: readonly string[]; defaultPublic: boolean }>;

export type VisibilityField = keyof typeof VISIBILITY_FIELDS;

/** Does the fighter's own `public_visibility` map let this field show? */
export function isFieldPublic(visibility: unknown, field: VisibilityField): boolean {
  const explicit = ((visibility ?? {}) as Record<string, unknown>)[field];
  return typeof explicit === 'boolean' ? explicit : VISIBILITY_FIELDS[field].defaultPublic;
}
