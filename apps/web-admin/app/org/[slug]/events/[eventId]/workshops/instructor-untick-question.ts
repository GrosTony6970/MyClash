import type { ConfirmOptions } from '@myclash/ui';
import type { Translator } from '@myclash/next-i18n/client';

/**
 * The question an organiser answers before a Save unticks instructors this Workshop says
 * something of its own about (ruling 561), or null when nothing would be lost.
 *
 * Unticking deletes the instructor's line on the Workshop, and with it the bio, club line and
 * photo written for this Workshop; ticking them again starts from their profile. `names` are the
 * unticked instructors whose line holds any of the three, as just read from the server: the
 * instructor may have written theirs from their own page since this page loaded.
 */
export function instructorUntickQuestion(
  names: readonly string[],
  t: Translator,
): ConfirmOptions | null {
  if (names.length === 0) return null;
  return {
    title: t('organizer.workshopsPage.instructorUntick.title'),
    description: t('organizer.workshopsPage.instructorUntick.body', { names: names.join(', ') }),
    confirmLabel: t('organizer.workshopsPage.instructorUntick.yes'),
    cancelLabel: t('common.cancel'),
    danger: true,
  };
}
