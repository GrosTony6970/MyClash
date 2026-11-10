import { failureCode, failureMessage, type ApiFailure } from '@myclash/api-client';
import type { Translator } from '@myclash/next-i18n/client';

/**
 * Who was in the room, ticked from the organiser's roster (operator rulings 539-545). A seat or a
 * waiting-list place has a box; a refused person has none (541). A tick changes no booking.
 */

/** The bookings a box is drawn for. */
export function canTick(status: string): boolean {
  return status === 'confirmed' || status === 'waitlisted';
}

/** A refused tick, in the reader's language: the server's own sentences are English. */
export function checkInRefusal(failure: ApiFailure, t: Translator): string | null {
  const words: Record<string, string> = {
    CHECK_IN_REFUSED_BOOKING: 'organizer.workshopsPage.checkInRefused',
    WORKSHOP_SESSION_CANCELLED: 'organizer.workshopsPage.message.sessionCancelled',
    NOT_FOUND: 'organizer.workshopsPage.checkInGone',
  };
  const key = words[failureCode(failure) ?? ''];
  return key ? t(key) : failureMessage(failure, t, t('organizer.workshopsPage.checkInFailed'));
}
