import { afterEach, describe, expect, it, vi } from 'vitest';
import { filtersFor, selectsFor } from '../../common/testing/supabase-chain';
import { EVENT, moderation, photoRow, USER } from './testing/moderation-doubles';

/**
 * The Reported tab (slice 4c, rulings 452, 455, 456): the queue reads each photo's reports, the
 * Reported tab only photos with one, and the head counts them. The double ignores the projection
 * and `!inner`, so the select strings are the guard here; the live PostgREST read is the proof
 * (the plan's Task 4).
 */

const COLUMNS =
  'id, status, uploader_name, caption, created_at, preview_key, original_key, tournament:tournaments(name), workshop:workshops(title)';
const T1 = '2026-11-07T10:00:00.111111+00:00';
const T2 = '2026-11-07T11:00:00.222222+00:00';
const T3 = '2026-11-07T12:00:00.333333+00:00';

afterEach(() => vi.restoreAllMocks());

describe('the queue reads the reports', () => {
  it('reads the reported tab through an inner embed of the reports, with no status filter', async () => {
    const { organiser, supabase } = moderation({ photos: [photoRow(0, { status: 'approved' })] });

    await organiser.list(EVENT, USER, 'reported');

    expect(selectsFor(supabase.from, 'event_photos')).toEqual([
      `${COLUMNS}, reports:event_photo_reports!inner(comment, created_at)`,
    ]);
    const columns = filtersFor(supabase.from, 'event_photos', 'eq').map(([column]) => column);
    expect(columns).toEqual(['event_id']);
  });

  it.each(['waiting', 'all'] as const)(
    '%s embeds the reports without narrowing the list',
    async (filter) => {
      const { organiser, supabase } = moderation({ photos: [photoRow(0)] });

      await organiser.list(EVENT, USER, filter);

      expect(selectsFor(supabase.from, 'event_photos')).toEqual([
        `${COLUMNS}, reports:event_photo_reports(comment, created_at)`,
      ]);
    },
  );

  it('gives the count, the comments newest first without empty ones, and the newest report time', async () => {
    const reports = [
      { comment: 'old', created_at: T1 },
      { comment: null, created_at: T3 },
      { comment: 'new', created_at: T2 },
    ];
    const { organiser } = moderation({ photos: [photoRow(0, { status: 'approved', reports })] });

    const [photo] = (await organiser.list(EVENT, USER, 'reported')).photos;

    expect(photo).toMatchObject({
      reportCount: 3,
      reportComments: ['new', 'old'],
      lastReportAt: T3,
    });
  });

  it('gives 0, no comment and no time for a photo with no report', async () => {
    const { organiser } = moderation({ photos: [photoRow(0)] });

    const [photo] = (await organiser.list(EVENT, USER, 'all')).photos;

    expect(photo).toMatchObject({ reportCount: 0, reportComments: [], lastReportAt: null });
  });
});

describe('the reported count', () => {
  it('counts the reported photos in the summary through the same inner embed', async () => {
    const reports = [{ comment: null, created_at: T1 }];
    const photos = [photoRow(0, { status: 'approved', reports }), photoRow(1, { reports })];
    const { organiser, supabase } = moderation({ photos });

    const summary = await organiser.summary(EVENT, USER);

    // The double counts every photo of the Event: the select string names what PostgREST counts.
    expect(summary.reported).toBe(2);
    expect(selectsFor(supabase.from, 'event_photos')).toContain(
      'id, event_photo_reports!inner(photo_id)',
    );
  });

  it('says 0 reported from the deletion instant on, and reads nothing for it', async () => {
    const reports = [{ comment: null, created_at: T1 }];
    const { service, organiser, supabase } = moderation({
      photos: [photoRow(0, { status: 'approved', reports })],
    });
    service.now = () => new Date('2026-12-08T23:00:00.000Z');

    expect((await organiser.summary(EVENT, USER)).reported).toBe(0);
    expect(selectsFor(supabase.from, 'event_photos')).toEqual([]);
  });
});
