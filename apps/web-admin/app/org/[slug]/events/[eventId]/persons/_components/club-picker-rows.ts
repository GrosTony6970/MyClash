/**
 * Pure helper used by the add-participant club picker.
 *
 * Given the user's typed text and the current backend-filtered
 * suggestions, decide what rows to render in the dropdown:
 *   - the existing suggestions, in order; and
 *   - a synthetic "+ Create new club X" row when the typed text
 *     has no case-insensitive trimmed match among the suggestions.
 *
 * Returning `[]` for empty input is what lets the JSX hide the
 * dropdown entirely when the field is blank.
 *
 * Kept as a pure function so the testable decision lives outside
 * the React component — match-scores-merge.ts / compute-wizard-step.ts
 * are the established pattern in this app.
 */
export interface ClubSuggestion {
  id: string;
  name: string;
  abbreviation?: string | null;
}

export type ClubPickerRow =
  { kind: 'existing'; club: ClubSuggestion } | { kind: 'create'; name: string };

export function computeClubPickerRows(
  typedText: string,
  suggestions: ReadonlyArray<ClubSuggestion>,
): ClubPickerRow[] {
  const trimmed = typedText.trim();
  if (!trimmed) return [];

  const existingRows: ClubPickerRow[] = suggestions.map((club) => ({ kind: 'existing', club }));

  const hasExactMatch = suggestions.some(
    (c) => c.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );

  if (hasExactMatch) return existingRows;
  return [...existingRows, { kind: 'create', name: trimmed }];
}
