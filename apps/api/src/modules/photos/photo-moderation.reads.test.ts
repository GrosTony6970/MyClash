import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { filtersFor, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import {
  arrivedAt,
  EVENT,
  moderation,
  ORG,
  photoRow,
  recordingStore,
  USER,
} from './testing/moderation-doubles';

/**
 * The organiser's moderation queue, read side (design, "Moderation"): the page head and the
 * queue's pages, each photo with its two signed links.
 */

const NOW = new Date('2026-11-07T15:02:00Z');
const QUEUE_SELECT =
  'id, status, uploader_name, caption, created_at, preview_key, original_key, tournament:tournaments(name), workshop:workshops(title), reports:event_photo_reports(comment, updated_at)';

afterEach(() => vi.restoreAllMocks());

describe('the organiser gate', () => {
  it.each(['summary', 'list'] as const)(
    '%s refuses a non-admin before reading any photo',
    async (call) => {
      const { organiser, supabase, orgs } = moderation({ allowed: false, photos: [photoRow(0)] });

      const read =
        call === 'summary' ? organiser.summary(EVENT, USER) : organiser.list(EVENT, USER, 'all');
      await expect(read).rejects.toThrow('Not an admin of this club');

      expect(orgs.assertOrgRole).toHaveBeenCalledWith(ORG, USER, 'admin');
      expect(queriedTables(supabase.from)).toEqual(['events']);
      expect(supabase.rpc).not.toHaveBeenCalled();
    },
  );

  it('answers 404 for an Event that does not exist', async () => {
    const { organiser, orgs } = moderation({ event: null });
    await expect(organiser.list(EVENT, USER, 'all')).rejects.toThrow('Event not found');
    expect(orgs.assertOrgRole).not.toHaveBeenCalled();
  });

  it('reads the Event columns both photo gates need, in one literal select', async () => {
    const { organiser, supabase } = moderation();
    await organiser.summary(EVENT, USER);
    expect(selectsFor(supabase.from, 'events')).toEqual([
      'id, organization_id, slug, name, start_date, end_date, timezone, photo_mode, photo_token_version',
    ]);
  });
});

describe('list', () => {
  const sixtyOne = Array.from({ length: 61 }, (_, n) => photoRow(n));

  it('gives the newest 60 waiting photos of this Event, and the cursor of the 60th', async () => {
    // Seeded oldest first: newest first can only come from the query's own sort.
    const photos = [
      ...[...sixtyOne].reverse(),
      photoRow(70, { status: 'approved' }),
      photoRow(71, { event_id: 'another-event' }),
    ];
    const { service, organiser, supabase } = moderation({ photos });
    service.now = () => NOW;

    const page = await organiser.list(EVENT, USER, 'waiting');

    expect(page.photos.map((p) => p.id)).toEqual(sixtyOne.slice(0, 60).map((r) => r.id));
    // Byte for byte as the database wrote it: a re-formatted cursor would drop microseconds.
    expect(page.next).toBe(arrivedAt(59));
    expect(selectsFor(supabase.from, 'event_photos')).toEqual([QUEUE_SELECT]);
    expect(filtersFor(supabase.from, 'event_photos', 'eq')).toEqual([
      ['event_id', EVENT],
      ['status', 'waiting'],
    ]);
  });

  it('All drops the status filter; fewer than a page leaves no cursor', async () => {
    const photos = [photoRow(0), photoRow(1, { status: 'approved' })];
    const { organiser } = moderation({ photos });

    const page = await organiser.list(EVENT, USER, 'all');

    expect(page.photos.map((p) => p.status)).toEqual(['waiting', 'approved']);
    expect(page.next).toBeNull();
  });

  it('starts after the cursor', async () => {
    const { organiser, supabase } = moderation({ photos: sixtyOne });

    const page = await organiser.list(EVENT, USER, 'all', arrivedAt(59));

    expect(page.photos.map((p) => p.id)).toEqual([sixtyOne[60]!.id]);
    expect(filtersFor(supabase.from, 'event_photos', 'lt')).toEqual([
      ['created_at', arrivedAt(59)],
    ]);
  });

  it('tags a photo with its Tournament or Workshop, or with nothing', async () => {
    const photos = [
      photoRow(0, { tournament: { name: 'Longsword Open' } }),
      photoRow(1, { workshop: { title: 'Messer basics' } }),
      photoRow(2, { uploader_name: 'Léa', caption: 'Final' }),
    ];
    const { organiser } = moderation({ photos });

    const page = await organiser.list(EVENT, USER, 'all');

    expect(page.photos.map((p) => p.tag)).toEqual([
      { kind: 'tournament', name: 'Longsword Open' },
      { kind: 'workshop', name: 'Messer basics' },
      null,
    ]);
    expect(page.photos[2]).toMatchObject({ uploaderName: 'Léa', caption: 'Final' });
    expect(page.photos[0]!.createdAt).toBe(arrivedAt(0));
  });
});

describe('the signed links', () => {
  it('signs each preview and each original at the clock of the request', async () => {
    const { service, organiser } = moderation({ photos: [photoRow(0)] });
    service.now = () => NOW;

    const [photo] = (await organiser.list(EVENT, USER, 'all')).photos;

    expect(photo!.previewUrl).toBe(
      `https://signed.test/${photoRow(0).preview_key}@${NOW.toISOString()}`,
    );
    expect(photo!.originalUrl).toBe(
      `https://signed.test/${photoRow(0).original_key}@${NOW.toISOString()}`,
    );
  });

  it('a signer that fails leaves that photo without links, and signs the rest', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const store = recordingStore(photoRow(1).original_key as string);
    const { organiser } = moderation({ photos: [photoRow(0), photoRow(1)], store });

    const { photos } = await organiser.list(EVENT, USER, 'all');

    expect(photos[0]!.previewUrl).not.toBeNull();
    expect(photos[1]).toMatchObject({ previewUrl: null, originalUrl: null });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(photoRow(1).id as string));
  });

  it('with no bucket every link is null, and the head says storage is off', async () => {
    const { organiser } = moderation({ photos: [photoRow(0)], store: null });

    const { photos } = await organiser.list(EVENT, USER, 'all');
    const summary = await organiser.summary(EVENT, USER);

    expect(photos[0]).toMatchObject({ previewUrl: null, originalUrl: null });
    expect(summary.storage).toBe('off');
  });
});

describe('the deletion instant', () => {
  // 00:00 on end_date + 31 (2026-12-09) in Paris is 23:00 UTC the day before.
  const INSTANT = new Date('2026-12-08T23:00:00Z');

  it('shows the photos up to the instant, and none from it on', async () => {
    const { service, organiser, supabase } = moderation({ photos: [photoRow(0)] });

    service.now = () => new Date(INSTANT.getTime() - 1);
    expect((await organiser.list(EVENT, USER, 'all')).photos).toHaveLength(1);

    service.now = () => INSTANT;
    expect(await organiser.list(EVENT, USER, 'all')).toEqual({ photos: [], next: null });
    expect(queriedTables(supabase.from).filter((t) => t === 'event_photos')).toHaveLength(1);
  });
});

describe('summary', () => {
  it('reads the mode, the caps, the waiting count and the deletion date', async () => {
    const photos = [photoRow(0), photoRow(1), photoRow(2, { status: 'approved' })];
    const { organiser, supabase } = moderation({
      photos,
      usage: { event_last_hour: 12, event_bytes: '2500000000' },
    });

    const summary = await organiser.summary(EVENT, USER);

    expect(summary).toEqual({
      mode: 'approve',
      eventSlug: 'open-2026',
      eventName: 'Open 2026',
      storage: 'on',
      lastHour: 12,
      perHourCap: 300,
      bytes: 2_500_000_000,
      bytesCap: 15_000_000_000,
      waiting: 2,
      // The double ignores `!inner` and counts every photo of the Event; the Reported tab's
      // own tests pin what PostgREST is asked (`photo-moderation.reported.test.ts`).
      reported: 3,
      deletesAt: '2026-12-08T23:00:00.000Z',
      timezone: 'Europe/Paris',
    });
    expect(supabase.rpc).toHaveBeenCalledWith('event_photo_usage', {
      p_event_id: EVENT,
      p_device_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(selectsFor(supabase.from, 'event_photos')).toEqual([
      'id',
      'id, event_photo_reports!inner(photo_id)',
    ]);
  });

  it('counts nothing waiting from the deletion instant on, as the queue shows nothing', async () => {
    const { service, organiser } = moderation({ photos: [photoRow(0), photoRow(1)] });

    service.now = () => new Date('2026-12-08T22:59:59.999Z');
    expect((await organiser.summary(EVENT, USER)).waiting).toBe(2);

    service.now = () => new Date('2026-12-08T23:00:00.000Z');
    expect((await organiser.summary(EVENT, USER)).waiting).toBe(0);
  });
});
