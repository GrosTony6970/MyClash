/**
 * The letter keys of the bout screen (quick win P19; operator, 2026-10-12):
 * D is the Double button, U is "Undo last entry". A laptop table scores
 * without the mouse.
 *
 * A key PRESSES ITS BUTTON. The button declares its key (`data-pad-key`), and
 * the key does nothing when that button is not on the screen or is disabled.
 * So the key can never do what the screen says it cannot: the rules of the
 * Double button and of the undo stay where they are, in one place each.
 *
 * `code` is the place of the key on the keyboard, not its letter. D and U are
 * at the same place on a QWERTY and on a French AZERTY keyboard.
 */
export const PAD_KEYS = { double: 'KeyD', undo: 'KeyU' } as const;

const CODES: readonly string[] = Object.values(PAD_KEYS);

type Key = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey'>;

/**
 * Is this the press of a letter key of the pad? Not with Ctrl, Cmd or Alt:
 * Ctrl+D is the browser's own.
 */
export function isPadLetter(key: Key): boolean {
  return CODES.includes(key.code) && !key.ctrlKey && !key.metaKey && !key.altKey;
}

/** Presses the live button that declares this key. False: no such button, and nothing is done. */
export function pressButtonOf(code: string, page: Pick<Document, 'querySelector'>): boolean {
  const button = page.querySelector<HTMLButtonElement>(`button[data-pad-key="${code}"]`);
  if (!button || button.disabled) return false;
  button.click();
  return true;
}
