import type { ConfirmOptions } from '@myclash/ui';
import type { Translator } from '@myclash/next-i18n/client';

/**
 * The question an organiser answers before a Workshop's session is deleted, or
 * null when the delete is sent at once.
 *
 * The bookings of a session are deleted with it, the waiting list too, and
 * nothing brings them back. `booked` is the roster's size as just read from the
 * server, the waiting list included: the page's own list can be minutes old.
 * Null is a roster that could not be read, which is not an empty one, so the
 * question is asked without a count. With nobody booked the delete only sends
 * the Workshop back to the drawer, and laying a programme out stays one click.
 */
export function sessionDeleteQuestion(
  title: string,
  booked: number | null,
  t: Translator,
): ConfirmOptions | null {
  if (booked === 0) return null;
  return {
    title: t('organizer.workshopsPage.sessionDelete.title', { title }),
    description:
      booked === null
        ? t('organizer.workshopsPage.sessionDelete.bodyUncounted')
        : t('organizer.workshopsPage.sessionDelete.body', { count: booked }),
    confirmLabel: t('organizer.workshopsPage.sessionDelete.yes'),
    cancelLabel: t('common.cancel'),
    danger: true,
  };
}
