/**
 * Whether opening a workshop session's roster reads it (quick-win M6).
 *
 * A failed read used to be final: the error flag was never cleared, so every later "View roster"
 * skipped the read and the instructor had to reload the page. Now an open reads when nothing was
 * read yet OR the last read failed (an older list may still be on screen after an accept whose
 * re-read failed), and never while a read is out (open, close, open again fast).
 */
export function rosterReadOnOpen(state: {
  roster: readonly unknown[] | null;
  failed: boolean;
  reading: boolean;
}): boolean {
  return !state.reading && (state.roster === null || state.failed);
}
