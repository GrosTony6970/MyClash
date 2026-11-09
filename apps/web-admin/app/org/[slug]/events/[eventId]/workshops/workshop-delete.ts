import { failureCode, failureMessage, type ApiFailure } from '@myclash/api-client';
import type { ConfirmOptions } from '@myclash/ui';
import type { Translator } from '@myclash/next-i18n/client';

/**
 * Deleting a Workshop (operator ruling, 2026-11-09): only one nobody is booked on. The server
 * decides who is booked: the page's own list can be minutes old.
 */
export function workshopDeleteQuestion(title: string, t: Translator): ConfirmOptions {
  return {
    title: t('organizer.workshopsPage.workshopDelete.title', { title }),
    description: t('organizer.workshopsPage.workshopDelete.body'),
    confirmLabel: t('organizer.workshopsPage.workshopDelete.yes'),
    cancelLabel: t('common.cancel'),
    danger: true,
  };
}

/**
 * A refused delete, in the reader's language. People still booked have a sentence of their own,
 * which says the way out; any other failure is worded by `failureMessage`.
 */
export function workshopDeleteRefusal(failure: ApiFailure, t: Translator): string | null {
  if (failureCode(failure) === 'WORKSHOP_HAS_BOOKINGS') {
    return t('organizer.workshopsPage.workshopDelete.hasBookings');
  }
  return failureMessage(failure, t, t('admin.common.deleteFailed'));
}
