import {
  failureCode,
  failureMessage,
  isArchivedEventRefusal,
  type ApiFailure,
} from '@myclash/api-client';
import { isPhotoUploadRefusal, PHOTO_MAX_BYTES, type PhotoUploadRefusal } from '@myclash/types';
import type { LocalRefusal } from './photo-checks';

/**
 * What a refused photo says, and what the page does next.
 *
 * - `photo`: this photo fails, the next one is sent (its own bytes were refused).
 * - `stop`: this photo fails with Retry, and the rest wait for Send (something passing).
 * - `closed`: the form gives way to the reason; nothing more can be sent from this page now.
 */
export type RefusalEnd = 'photo' | 'stop' | 'closed';
export interface RefusalView {
  end: RefusalEnd;
  message: string;
}

type Translate = (key: string, values?: Record<string, string>) => string;

/** Every code of `POST events/:eventId/photos`: a new code that is not here does not compile. */
const REFUSALS: Record<PhotoUploadRefusal, { key: string; end: RefusalEnd }> = {
  photo_not_jpeg: { key: 'publicApp.photoSend.refusal.notJpeg', end: 'photo' },
  photo_heic: { key: 'publicApp.photoSend.refusal.heic', end: 'photo' },
  photo_unsupported_jpeg: { key: 'publicApp.photoSend.refusal.unsupportedJpeg', end: 'photo' },
  photo_too_many_pixels: { key: 'publicApp.photoSend.refusal.tooManyPixels', end: 'photo' },
  photo_corrupt: { key: 'publicApp.photoSend.refusal.corrupt', end: 'photo' },
  // No file arrived: nothing was wrong with the photo itself, so it is offered again.
  photo_missing: { key: 'publicApp.photoSend.refusal.missing', end: 'stop' },
  photos_unavailable: { key: 'publicApp.photoSend.refusal.unavailable', end: 'stop' },
  photos_busy: { key: 'publicApp.photoSend.refusal.busy', end: 'stop' },
  photo_text_too_long: { key: 'publicApp.photoSend.refusal.textTooLong', end: 'stop' },
  photo_tag_invalid: { key: 'publicApp.photoSend.refusal.tagInvalid', end: 'stop' },
  photo_link_invalid: { key: 'publicApp.photoSend.refusal.linkInvalid', end: 'closed' },
  photos_off: { key: 'publicApp.photoSend.refusal.off', end: 'closed' },
  photos_window_closed: { key: 'publicApp.photoSend.refusal.windowClosed', end: 'closed' },
  photo_device_limit: { key: 'publicApp.photoSend.refusal.deviceLimit', end: 'closed' },
  photo_event_limit: { key: 'publicApp.photoSend.refusal.eventLimit', end: 'closed' },
  photo_event_storage_full: { key: 'publicApp.photoSend.refusal.storageFull', end: 'closed' },
};

const MIB = 1024 * 1024;

/**
 * The sentence for a refused send. A photo code is read FIRST: `failureMessage` says every 429
 * with the throttler's generic sentence, and the phone's and the Event's limits are 429s too.
 */
export function refusalView(failure: ApiFailure, t: Translate): RefusalView {
  const code = failureCode(failure);
  if (isPhotoUploadRefusal(code)) {
    const { key, end } = REFUSALS[code];
    return { end, message: t(key) };
  }
  // No Retry can land: the Event is gone (a 404 is "Event not found", in English), or archived
  // (the global Event lock, said by `failureMessage` in the reader's language).
  if (failure.kind === 'http' && failure.status === 404) {
    return { end: 'closed', message: t(REFUSALS.photo_link_invalid.key) };
  }
  const notSent = t('publicApp.photoSend.notSent');
  if (isArchivedEventRefusal(failure)) {
    return { end: 'closed', message: failureMessage(failure, t, notSent) ?? notSent };
  }
  return {
    end: code === 'file_too_large' ? 'photo' : 'stop',
    message: failureMessage(failure, t, notSent) ?? notSent,
  };
}

/** The sentence for a photo the page refused before sending: the API's own for the same reason. */
export function localRefusalView(code: LocalRefusal, t: Translate): RefusalView {
  if (code !== 'file_too_large') return { end: 'photo', message: t(REFUSALS[code].key) };
  return {
    end: 'photo',
    message: t('common.apiFailure.fileTooLarge', { mb: String(Math.floor(PHOTO_MAX_BYTES / MIB)) }),
  };
}
