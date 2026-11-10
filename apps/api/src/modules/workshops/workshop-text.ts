/**
 * A Workshop's two short texts the organiser and its instructor fill in (ruling 557): the line on
 * the catalogue card, and what a learner should know or bring. Plain text, no Markdown. Their
 * limits are shared with the forms (`@myclash/types`).
 */
export {
  WORKSHOP_PREREQUISITES_MAX as PREREQUISITES_MAX,
  WORKSHOP_SHORT_DESCRIPTION_MAX as SHORT_DESCRIPTION_MAX,
} from '@myclash/types';

/**
 * What to store for a text field a form sent: trimmed, and a blank box clears it (null). Left
 * out (`undefined`) means "not sent": the caller keeps the stored value.
 */
export function textOrNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value?.trim() || null;
}

/** Writes the two texts a Workshop update was sent: the organiser's door and the instructor's. */
export function writeTexts(
  updates: Record<string, unknown>,
  dto: { shortDescription?: string | null; prerequisites?: string | null },
): void {
  const shortDescription = textOrNull(dto.shortDescription);
  const prerequisites = textOrNull(dto.prerequisites);
  if (shortDescription !== undefined) updates['short_description'] = shortDescription;
  if (prerequisites !== undefined) updates['prerequisites'] = prerequisites;
}
