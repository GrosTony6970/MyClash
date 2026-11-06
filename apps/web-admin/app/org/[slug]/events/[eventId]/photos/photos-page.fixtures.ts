import type { ModerationPhoto, PhotoQueuePage, PhotoSummary } from '@myclash/types';

/** The Photos page's reads, as a stand-in server answers them. */

export const SUMMARY_READ = '/api/v1/events/ev1/photos/summary';
export const LINK_READ = '/api/v1/events/ev1/photos/link';
export const waitingRead = '/api/v1/events/ev1/photos?filter=waiting';
export const allRead = '/api/v1/events/ev1/photos?filter=all';
export const reportedRead = '/api/v1/events/ev1/photos?filter=reported';
export const TOURNAMENTS_READ = '/api/v1/events/ev1/tournaments';
export const WORKSHOPS_READ = '/api/v1/events/ev1/workshops';

/** The newest report of the reported photo p3, as the database wrote it. */
export const LAST_REPORT = '2026-11-07T16:30:00.654321+00:00';

export const SUMMARY: PhotoSummary = {
  mode: 'approve',
  eventSlug: 'open-2025',
  eventName: 'Open 2025',
  storage: 'on',
  lastHour: 12,
  perHourCap: 300,
  bytes: 2_500_000_000,
  bytesCap: 15_000_000_000,
  waiting: 2,
  reported: 1,
  deletesAt: '2026-12-08T23:00:00.000Z',
  timezone: 'Europe/Paris',
};

export function photo(id: string, over: Partial<ModerationPhoto> = {}): ModerationPhoto {
  return {
    id,
    status: 'waiting',
    uploaderName: 'Léa',
    caption: 'Final',
    tag: { kind: 'tournament', name: 'Longsword Open' },
    createdAt: '2026-11-07T15:00:00.123456+00:00',
    previewUrl: `https://bucket.test/${id}/preview.jpg?sig=1`,
    originalUrl: `https://bucket.test/${id}/original.jpg?sig=1`,
    reportCount: 0,
    reportComments: [],
    lastReportAt: null,
    ...over,
  };
}

/** An approved photo three phones reported, two of them with a comment. */
export const reportedPhoto = (id = 'p3'): ModerationPhoto =>
  photo(id, {
    status: 'approved',
    reportCount: 3,
    reportComments: ['this is me, please remove', 'blurry'],
    lastReportAt: LAST_REPORT,
  });

export const page = (photos: ModerationPhoto[], next: string | null = null): PhotoQueuePage => ({
  photos,
  next,
});

/**
 * Every read of the page with two waiting photos, p1 and p2, and the reported photo p3. Reported
 * is answered by default: a page that presses every tab reads it.
 */
export function photoReads(
  over: {
    summary?: Partial<PhotoSummary>;
    waiting?: PhotoQueuePage;
    reported?: PhotoQueuePage;
    all?: PhotoQueuePage;
  } = {},
): Record<string, unknown> {
  const waiting = over.waiting ?? page([photo('p1'), photo('p2')]);
  return {
    '/api/v1/events/ev1': { id: 'ev1', slug: 'open-2025', name: 'Open 2025', status: 'running' },
    [SUMMARY_READ]: { ...SUMMARY, ...over.summary },
    [LINK_READ]: { token: 'tok_1', version: 1 },
    [waitingRead]: waiting,
    [reportedRead]: over.reported ?? page([reportedPhoto()]),
    [allRead]: over.all ?? waiting,
    // The download's choice of photos (slice 7b).
    [TOURNAMENTS_READ]: [{ id: 't1', name: 'Longsword Open' }],
    [WORKSHOPS_READ]: [{ id: 'w1', title: 'Rapier basics' }],
  };
}
