import { isValidPinShape, isWeakPin, type WeakPinReason } from '@myclash/types';

/**
 * Static keys rather than `t(\`…weakPin.${reason}\`)`: a template-literal key is
 * invisible to the i18n reverse sweep, which would then report all four strings
 * as orphans and prune them out from under this file.
 */
const WEAK_PIN_KEYS: Record<WeakPinReason, string> = {
  repeated_digit: 'organizer.staff.weakPin.repeated_digit',
  sequence: 'organizer.staff.weakPin.sequence',
  repeated_block: 'organizer.staff.weakPin.repeated_block',
  common: 'organizer.staff.weakPin.common',
};

/**
 * Why this PIN cannot be saved, already translated — or null if it can.
 *
 * Runs the same `@myclash/types` rules the API runs in `hashPin`, so the
 * organiser reads the reason while typing instead of collecting a 400 with a
 * volunteer waiting at the desk. The server keeps its own check: this is the
 * affordance, not the enforcement.
 */
export function pinProblem(pin: string, t: (key: string) => string): string | null {
  if (!isValidPinShape(pin)) return t('organizer.staff.pinHint');
  const weakness = isWeakPin(pin);
  return weakness === null ? null : t(WEAK_PIN_KEYS[weakness]);
}
