/**
 * Has the person typed the word that confirms an account deletion (quick-win M3, operator
 * 2026-10-14)?
 *
 * The word is the reader's own (DELETE in English, SUPPRIMER in French). Small letters and stray
 * spaces count: the box showed DELETE in capitals while it held "delete", and the button stayed
 * dead. What the page SENDS is the API's literal, `DELETE_CONFIRMATION`, never what was typed.
 * The model is the pad's reset phrase (`apps/web-staff/src/lib/reset-phrase.ts`).
 */
export function deleteWordTyped(typed: string, word: string): boolean {
  const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toUpperCase();
  return normalize(word) !== '' && normalize(typed) === normalize(word);
}
