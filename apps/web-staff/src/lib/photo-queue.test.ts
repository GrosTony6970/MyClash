import { describe, expect, it } from 'vitest';
import type { ModerationPhoto, PhotoQueuePage } from '@myclash/types';
import type { ApiResult } from '@myclash/api-client';
import {
  EMPTY_QUEUE,
  photoFailureKey,
  photoPagePath,
  photoQueueReducer,
  shouldReloadOnImageError,
  STALE_LINKS_MS,
} from './photo-queue';

const photo = (id: string): ModerationPhoto => ({
  id,
  status: 'waiting',
  uploaderName: null,
  caption: null,
  tag: null,
  createdAt: '2026-11-05T12:00:00.123456+00:00',
  previewUrl: null,
  originalUrl: null,
});
const page = (ids: string[], next: string | null = null): PhotoQueuePage => ({
  photos: ids.map(photo),
  next,
});
/** As `apiRequest` builds it: a 401 or a 403 is `unauthenticated` (request.ts), the rest `http`. */
const refusal = (status: number, code: string | null): ApiResult<unknown> =>
  ({
    ok: false,
    kind: status === 401 || status === 403 ? 'unauthenticated' : 'http',
    status,
    code,
    detail: 'English',
    details: null,
  }) as never;

describe('photoQueueReducer', () => {
  it('replaces the list on a read of page 1 and starts a new generation', () => {
    const first = photoQueueReducer(EMPTY_QUEUE, { type: 'read', page: page(['a'], 'c1'), at: 5 });
    const second = photoQueueReducer(first, { type: 'read', page: page(['b']), at: 9 });

    expect(second.photos.map((p) => p.id)).toEqual(['b']);
    expect(second.next).toBeNull();
    expect(second.generation).toBe(first.generation + 1);
    expect(second.loadedAt).toBe(9);
  });

  it('appends a next page read in the same generation', () => {
    const read = photoQueueReducer(EMPTY_QUEUE, { type: 'read', page: page(['a'], 'c1'), at: 5 });
    const more = photoQueueReducer(read, {
      type: 'more',
      page: page(['b'], 'c2'),
      generation: read.generation,
    });

    expect(more.photos.map((p) => p.id)).toEqual(['a', 'b']);
    expect(more.next).toBe('c2');
  });

  // The Load-more race of the admin page (5a review, I1): a next page asked before a tab change
  // or a write's reload must not land under the fresh page 1.
  it('drops a next page that answers after page 1 was read again', () => {
    const old = photoQueueReducer(EMPTY_QUEUE, { type: 'read', page: page(['a'], 'c1'), at: 5 });
    const fresh = photoQueueReducer(old, { type: 'read', page: page(['z']), at: 9 });
    const late = photoQueueReducer(fresh, {
      type: 'more',
      page: page(['b']),
      generation: old.generation,
    });

    expect(late).toBe(fresh);
  });

  // A tab change shows the old tab's list until the new page 1 lands: its cursor must not be
  // offered meanwhile, nor a page it asked for land under the new tab.
  it('closes Load more while page 1 is read, and drops a next page asked before', () => {
    const old = photoQueueReducer(EMPTY_QUEUE, { type: 'read', page: page(['a'], 'c1'), at: 5 });
    const reading = photoQueueReducer(old, { type: 'reading' });
    const late = photoQueueReducer(reading, {
      type: 'more',
      page: page(['b']),
      generation: old.generation,
    });

    expect(reading.next).toBeNull();
    expect(late).toBe(reading);
  });
});

describe('photoPagePath', () => {
  it('asks the staff queue for a tab', () => {
    expect(photoPagePath('waiting')).toBe('/api/v1/staff/photos?filter=waiting');
  });

  it('carries the cursor as the database wrote it, encoded', () => {
    expect(photoPagePath('all', '2026-11-05T12:00:00.123456+00:00')).toBe(
      '/api/v1/staff/photos?filter=all&before=2026-11-05T12%3A00%3A00.123456%2B00%3A00',
    );
  });
});

describe('shouldReloadOnImageError', () => {
  it('reloads when the links are older than ten minutes: they may have expired', () => {
    expect(STALE_LINKS_MS).toBe(600_000);
    expect(shouldReloadOnImageError(0, 11 * 60_000)).toBe(true);
  });

  it('does not reload a fresh read, so a broken image cannot loop', () => {
    expect(shouldReloadOnImageError(0, 2 * 60_000)).toBe(false);
  });
});

describe('photoFailureKey', () => {
  it('says a photo another moderator deleted in the reader’s language', () => {
    expect(photoFailureKey(refusal(404, 'photo_not_found'))).toBe('scoring.photos.alreadyDeleted');
  });

  it('says the Event is closed, not the server’s English about scoring', () => {
    expect(photoFailureKey(refusal(403, 'event_results_frozen'))).toBe(
      'scoring.photos.eventClosed',
    );
  });

  it('leaves every other refusal to failureMessage', () => {
    expect(photoFailureKey(refusal(403, 'staff_role_not_allowed'))).toBeNull();
    expect(photoFailureKey({ ok: true, status: 200, data: {} } as never)).toBeNull();
  });
});
