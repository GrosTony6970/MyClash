import { isValidPinShape, isWeakPin, type WeakPinReason } from '@myclash/types';
import type { PromptOptions, Translator } from '@myclash/ui';
import type { StaffAccount } from './types';

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

/**
 * The reset-PIN box (O27, ruled 2026-10-14): it names whose PIN it is and states the rule,
 * checks the PIN as it is typed (the reason under the field, Reset off), and can show what was
 * typed. It used to ask for "PIN" alone, and a refused one came back as a line above the list.
 */
export function pinPromptOptions(
  account: Pick<StaffAccount, 'display_name'>,
  t: Translator,
): PromptOptions {
  return {
    title: t('organizer.staff.resetPinFor', { name: account.display_name }),
    description: t('organizer.staff.pinHint'),
    fieldLabel: t('organizer.staff.newPin'),
    masked: true,
    revealable: { show: t('organizer.staff.showPin'), hide: t('organizer.staff.hidePin') },
    validate: (pin) => pinProblem(pin, t),
    confirmLabel: t('organizer.staff.resetPin'),
    cancelLabel: t('common.cancel'),
  };
}
