/**
 * Which shortcut a rejected staff PIN took. Returned rather than a boolean so
 * the organiser is told WHICH rule they hit — "invalid PIN" at a desk with a
 * volunteer waiting is an invitation to try `123457` next.
 *
 * Enforced where a PIN is SET (create and reset), never on login: a policy
 * check on the login path would turn a wrong credential into a 400, and 400 is
 * not in the Traefik jail's `statuscode` list — the attempt would stop being
 * counted. The rate ceiling on login is `@ThrottleByStaffAccount` instead.
 *
 * Lives here rather than in the API for the same reason `validatePassword`
 * does: the organiser's form checks it as they type and the server checks it
 * again on the way in, and two implementations of "which PINs are too
 * guessable" would drift — the first symptom being a form that accepts what
 * the API rejects.
 */
export type WeakPinReason = 'repeated_digit' | 'sequence' | 'repeated_block' | 'common';

/**
 * Digits only, 6 to 16 of them.
 *
 * No character-class rules on this surface: it is typed by a standing
 * volunteer on a borrowed tablet with a numeric keypad, and asking for a
 * symbol there buys less than the six-digit floor does. At 6 digits and 10
 * attempts an hour per account, the expected time to a hit is measured in
 * years — the length and the throttle are the control, the alphabet is not.
 */
export const STAFF_PIN_MIN_LENGTH = 6;
export const STAFF_PIN_MAX_LENGTH = 16;

/** Shape only — digits and length. `isWeakPin` answers the separate question. */
export function isValidPinShape(pin: string): boolean {
  return (
    pin.length >= STAFF_PIN_MIN_LENGTH && pin.length <= STAFF_PIN_MAX_LENGTH && /^[0-9]+$/.test(pin)
  );
}

/**
 * Classics the shape rules below do not catch — `112233` is neither one digit,
 * nor a run, nor a repeated block, and it is one of the most-chosen PINs there
 * is. Deliberately short: this removes a few hundred values out of 10⁶, so it
 * costs the keyspace nothing, and a list long enough to matter would start
 * rejecting PINs people picked for their own reasons.
 */
const COMMON_PINS = new Set([
  '112233',
  '122333',
  '111222',
  '123321',
  '321123',
  '100200',
  '159753',
  '357951',
  '147258',
  '258369',
  '369258',
  '789456',
  '456123',
  '123654',
  '654123',
]);

/** `000000`, `111111`, `99999999`. */
function isRepeatedDigit(pin: string): boolean {
  return new Set(pin).size === 1;
}

/**
 * A run of ±1 in a consistent direction: `123456`, `654321`, `0123456789`.
 *
 * Wraps at the ends, so `789012` and `210987` are runs too — a keypad has no
 * edge, and someone reaching for an easy PIN does not stop at 9.
 */
function isSequence(pin: string): boolean {
  if (pin.length < 2) return false;
  const step = (from: string, to: string) => (Number(to) - Number(from) + 10) % 10;
  const direction = step(pin[0] as string, pin[1] as string);
  if (direction !== 1 && direction !== 9) return false;
  for (let i = 1; i < pin.length - 1; i += 1) {
    if (step(pin[i] as string, pin[i + 1] as string) !== direction) return false;
  }
  return true;
}

/** A 2- or 3-digit unit typed over and over: `121212`, `123123`, `696969`. */
function isRepeatedBlock(pin: string): boolean {
  for (let unit = 2; unit <= 3; unit += 1) {
    if (pin.length % unit !== 0 || pin.length / unit < 2) continue;
    const block = pin.slice(0, unit);
    if (block.repeat(pin.length / unit) === pin) return true;
  }
  return false;
}

/**
 * The reason this PIN is too guessable, or null if it is acceptable.
 *
 * Order matters only for the message: `111111` is both one repeated digit and a
 * repeated block, and "every digit is the same" is the more useful thing to
 * say. Assumes the caller has already checked shape (digits, length) — this
 * answers "is it weak", not "is it well-formed".
 */
export function isWeakPin(pin: string): WeakPinReason | null {
  if (isRepeatedDigit(pin)) return 'repeated_digit';
  if (isSequence(pin)) return 'sequence';
  if (isRepeatedBlock(pin)) return 'repeated_block';
  if (COMMON_PINS.has(pin)) return 'common';
  return null;
}
