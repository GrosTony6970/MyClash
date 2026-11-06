import { describe, expect, it } from 'vitest';
import { messages } from '@myclash/i18n/public';
import { createTranslator } from '@myclash/i18n/runtime';
import type { ApiFailure } from '@myclash/api-client';
import { PHOTO_MAX_BYTES, PHOTO_UPLOAD_REFUSALS, type PhotoUploadRefusal } from '@myclash/types';
import { localRefusalView, refusalView, type RefusalEnd } from './photo-refusal';

const en = createTranslator(messages.en);
const fr = createTranslator(messages.fr);

/** Not a catalogue sentence, so no assertion can pass on the API's own words. */
const API_WORDS = 'The API said this in English.';

const STATUS: Record<PhotoUploadRefusal, number> = {
  photo_not_jpeg: 422,
  photo_heic: 422,
  photo_unsupported_jpeg: 422,
  photo_too_many_pixels: 422,
  photo_corrupt: 422,
  photo_link_invalid: 403,
  photos_off: 403,
  photos_window_closed: 403,
  photos_unavailable: 503,
  photos_busy: 503,
  photo_device_limit: 429,
  photo_event_limit: 429,
  photo_event_storage_full: 429,
  photo_text_too_long: 400,
  photo_tag_invalid: 400,
  photo_missing: 400,
  photo_not_your_event: 403,
  photo_no_name: 403,
  photo_account_limit: 429,
};

const END: Record<PhotoUploadRefusal, RefusalEnd> = {
  photo_not_jpeg: 'photo',
  photo_heic: 'photo',
  photo_unsupported_jpeg: 'photo',
  photo_too_many_pixels: 'photo',
  photo_corrupt: 'photo',
  photo_missing: 'stop',
  photos_unavailable: 'stop',
  photos_busy: 'stop',
  photo_text_too_long: 'stop',
  photo_tag_invalid: 'stop',
  photo_link_invalid: 'closed',
  photos_off: 'closed',
  photos_window_closed: 'closed',
  photo_device_limit: 'closed',
  photo_event_limit: 'closed',
  photo_event_storage_full: 'closed',
  photo_not_your_event: 'closed',
  photo_no_name: 'closed',
  photo_account_limit: 'closed',
};

/** A refusal as `responseFailure` files it: every 401 and 403 is `unauthenticated`. */
function refused(
  status: number,
  code: string | null,
  details: Record<string, unknown> | null = null,
): ApiFailure {
  return status === 403
    ? { kind: 'unauthenticated', status: 403, detail: API_WORDS, code, details }
    : { kind: 'http', status, detail: API_WORDS, code, details, validationErrors: null };
}

describe('every photo refusal of the API', () => {
  it.each(PHOTO_UPLOAD_REFUSALS)('%s is said in both languages and ends as ruled', (code) => {
    const failure = refused(STATUS[code], code);
    const english = refusalView(failure, en);
    const french = refusalView(failure, fr);
    for (const view of [english, french]) {
      expect(view.end).toBe(END[code]);
      expect(view.message).not.toBe(API_WORDS);
      expect(view.message).not.toMatch(/^publicApp\./);
    }
    expect(french.message).not.toBe(english.message);
  });

  it('gives each code its own sentence', () => {
    const said = PHOTO_UPLOAD_REFUSALS.map(
      (code) => refusalView(refused(STATUS[code], code), en).message,
    );
    expect(new Set(said).size).toBe(PHOTO_UPLOAD_REFUSALS.length);
  });
});

describe('the refusals that are not ours', () => {
  it("a 429 with the phone's code is the phone's limit, a bare 429 the throttler's", () => {
    expect(refusalView(refused(429, 'photo_device_limit'), en)).toEqual({
      end: 'closed',
      message: en('publicApp.photoSend.refusal.deviceLimit'),
    });
    expect(refusalView(refused(429, null), en)).toEqual({
      end: 'stop',
      message: en('common.apiFailure.tooManyRequests'),
    });
  });

  it('read-only mode is its own sentence, and stops the queue', () => {
    expect(refusalView(refused(503, 'read_only_mode'), en)).toEqual({
      end: 'stop',
      message: en('common.apiFailure.readOnlyMode'),
    });
  });

  it('a photo over the limit says 12 MB, and the next photo is still sent', () => {
    const view = refusalView(refused(413, 'file_too_large', { maxBytes: PHOTO_MAX_BYTES }), fr);
    expect(view).toEqual({
      end: 'photo',
      message: fr('common.apiFailure.fileTooLarge', { mb: '12' }),
    });
  });

  it('a lost connection, an edge 502 and an intermediary 403 stop the queue', () => {
    expect(refusalView({ kind: 'network' }, en)).toEqual({
      end: 'stop',
      message: en('common.apiFailure.network'),
    });
    expect(refusalView(refused(502, null), en)).toEqual({
      end: 'stop',
      message: en('publicApp.photoSend.notSent'),
    });
    const blocked: ApiFailure = {
      kind: 'unauthenticated',
      status: 403,
      detail: null,
      code: null,
      details: null,
    };
    expect(refusalView(blocked, en)).toEqual({
      end: 'stop',
      message: en('common.apiFailure.blocked'),
    });
  });

  it('an Event gone or archived closes the form: no Retry can land', () => {
    expect(refusalView(refused(404, null), fr)).toEqual({
      end: 'closed',
      message: fr('publicApp.photoSend.refusal.linkInvalid'),
    });
    expect(refusalView(refused(403, 'event_archived'), fr)).toEqual({
      end: 'closed',
      message: fr('common.apiFailure.eventArchived'),
    });
  });

  it('an abort, which the page drops, still reads as not sent', () => {
    expect(refusalView({ kind: 'aborted' }, en)).toEqual({
      end: 'stop',
      message: en('publicApp.photoSend.notSent'),
    });
  });
});

describe('the refusals said before sending', () => {
  it('use the same sentences as the API refusal they stand for', () => {
    expect(localRefusalView('photo_heic', fr)).toEqual(refusalView(refused(422, 'photo_heic'), fr));
    expect(localRefusalView('photo_not_jpeg', en)).toEqual(
      refusalView(refused(422, 'photo_not_jpeg'), en),
    );
    expect(localRefusalView('file_too_large', en)).toEqual({
      end: 'photo',
      message: en('common.apiFailure.fileTooLarge', { mb: '12' }),
    });
  });
});
