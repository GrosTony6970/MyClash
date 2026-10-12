/**
 * The words an official types before a bout is reset (quick win P9; operator,
 * 2026-10-12).
 *
 * The server takes exactly these words (`MatchesService.resetMatch`). The pad
 * asked for the same exact string from the keyboard: "reset match" in small
 * letters, or with a space after it, left the button dead with no word why. A
 * French official types two English words in capitals on a tablet keyboard.
 *
 * The brake is "type the two words", not "type them in capitals". So the pad
 * reads what was typed loosely, and sends the exact words itself.
 */
export const RESET_PHRASE = 'RESET MATCH';

/** Capitals do not matter, nor the spaces around the words or between them. */
export function resetPhraseTyped(typed: string): boolean {
  return typed.trim().replace(/\s+/g, ' ').toUpperCase() === RESET_PHRASE;
}
