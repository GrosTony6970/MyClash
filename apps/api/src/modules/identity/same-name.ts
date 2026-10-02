/**
 * same-name.ts: when two names are one name, for the profile resolver (operator ruling 211).
 * Pure: no I/O.
 */

/** The two halves of a person's name, as a roster row or a profile carries them. */
export interface NameParts {
  givenName: string | null | undefined;
  familyName: string | null | undefined;
}

/** A name as its words: lower case, no accents, cut on what is not a letter or a digit, sorted. */
function nameWords({ givenName, familyName }: NameParts): string[] {
  return `${givenName ?? ''} ${familyName ?? ''}`
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .sort();
}

/**
 * The same name is the same WORDS, whatever their order, case, accents or punctuation (operator
 * ruling 211): `Léa Roux`, `ROUX Lea` and `Léa  Roux.` are one name; `Tom Roux` and `Léa
 * Roux-Martin` are others. No word at all is no name, and equals nothing.
 *
 * Exact words, not a similarity score: nobody confirms this match. The import's "is this the same
 * fighter?" suggestion is a score, because an organiser answers it
 * (`PersonsService.findGlobalPersonMatch`). The price is the one the operator accepted: a middle
 * name, an initial or `Strauß` for `Strauss` is another name, and gets another profile.
 */
export function sameName(a: NameParts, b: NameParts): boolean {
  const words = nameWords(a);
  return words.length > 0 && words.join(' ') === nameWords(b).join(' ');
}
