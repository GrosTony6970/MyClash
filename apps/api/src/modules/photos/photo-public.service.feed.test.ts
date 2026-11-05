import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { filtersFor, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { arrivedAt, EVENT, photoRow, recordingStore } from './testing/moderation-doubles';
import {
  ANONYMOUS,
  DRAFT_WORKSHOP,
  HIDDEN_TOURNAMENT,
  MEMBER,
  publicPhotos,
  TOURNAMENT,
  WORKSHOP,
} from './testing/public-doubles';

/**
 * The public photo list (design, "The public"): approved photos only, newest first, of an Event
 * the caller may see; empty while photos are Off and from the deletion instant on; a tag the
 * caller may not read is dropped.
 */

const NOW = new Date('2026-11-07T15:02:00Z');
// 00:00 on 9 December (end_date 8 November + 31 days), Paris = 23:00 UTC the day before.
const DELETION = new Date('2026-12-08T23:00:00Z');
const FEED_SELECT =
  'id, uploader_name, caption, created_at, preview_key, original_key, tournament_id, tournament:tournaments(name), workshop:workshops(title, status)';

const approved = (n: number, over = {}) => photoRow(n, { status: 'approved', ...over });

function opened(options: Parameters<typeof publicPhotos>[0] = {}, now = NOW) {
  const doubles = publicPhotos(options);
  doubles.service.now = () => now;
  return doubles;
}

afterEach(() => vi.restoreAllMocks());

describe('the public list', () => {
  it('serves approved photos only, newest first, 30 a page, with the next cursor', async () => {
    // Seeded oldest first, with a waiting photo among them: the order and the status filter
    // can only come from the query.
    const rows = Array.from({ length: 32 }, (_, n) => approved(31 - n));
    rows.splice(10, 0, photoRow(40, { created_at: arrivedAt(5).replace('.123', '.124') }));
    const { service } = opened({ photos: rows });

    const first = await service.feed(EVENT, ANONYMOUS, {});
    expect(first.photos).toHaveLength(30);
    expect(first.photos.map((photo) => photo.createdAt)).toEqual(
      Array.from({ length: 30 }, (_, n) => arrivedAt(n)),
    );
    expect(first.next).toBe(arrivedAt(29));
    expect(first.photos[0]).not.toHaveProperty('status');

    const second = await service.feed(EVENT, ANONYMOUS, { before: first.next! });
    expect(second.photos.map((photo) => photo.createdAt)).toEqual([arrivedAt(30), arrivedAt(31)]);
    expect(second.next).toBeNull();
  });

  it('asks the database for the approved rows of this Event, in one literal select', async () => {
    const { service, supabase } = opened({ photos: [approved(0)] });
    await service.feed(EVENT, ANONYMOUS, {});

    expect(selectsFor(supabase.from, 'event_photos')).toEqual([FEED_SELECT]);
    expect(filtersFor(supabase.from, 'event_photos', 'eq')).toEqual(
      expect.arrayContaining([
        ['event_id', EVENT],
        ['status', 'approved'],
      ]),
    );
  });

  it('gives each photo its two signed links, its name, caption, tag and time', async () => {
    const row = approved(0, {
      uploader_name: 'Léa',
      caption: 'Final',
      tournament_id: TOURNAMENT,
      tournament: { name: 'Longsword Open' },
    });
    const { service } = opened({ photos: [row] });

    const [photo] = (await service.feed(EVENT, ANONYMOUS, {})).photos;
    expect(photo).toEqual({
      id: row['id'],
      uploaderName: 'Léa',
      caption: 'Final',
      tag: { kind: 'tournament', name: 'Longsword Open' },
      createdAt: arrivedAt(0),
      previewUrl: `https://signed.test/${String(row['preview_key'])}@${NOW.toISOString()}`,
      originalUrl: `https://signed.test/${String(row['original_key'])}@${NOW.toISOString()}`,
    });
  });

  it.each(['off', 'sideways'])('is empty when the stored mode is %s', async (photo_mode) => {
    const { service, supabase } = opened({ event: { photo_mode }, photos: [approved(0)] });
    expect(await service.feed(EVENT, ANONYMOUS, {})).toEqual({ photos: [], next: null });
    expect(queriedTables(supabase.from)).not.toContain('event_photos');
  });

  it('serves until the deletion instant, and is empty from it on', async () => {
    const before = opened({ photos: [approved(0)] }, new Date(DELETION.getTime() - 1));
    expect((await before.service.feed(EVENT, ANONYMOUS, {})).photos).toHaveLength(1);

    const at = opened({ photos: [approved(0)] }, DELETION);
    expect(await at.service.feed(EVENT, ANONYMOUS, {})).toEqual({ photos: [], next: null });
  });

  it('drops the tag of a Tournament hidden from the caller, and keeps the photo', async () => {
    const row = approved(0, {
      tournament_id: HIDDEN_TOURNAMENT,
      tournament: { name: 'Secret Cup' },
    });
    const { service } = opened({ photos: [row] });
    const [photo] = (await service.feed(EVENT, ANONYMOUS, {})).photos;
    expect(photo?.tag).toBeNull();

    // A member of the club sees the hidden Tournament, so its tag too.
    const member = opened({ photos: [row] });
    const [seen] = (await member.service.feed(EVENT, MEMBER, {})).photos;
    expect(seen?.tag).toEqual({ kind: 'tournament', name: 'Secret Cup' });
  });

  it('drops the tag of a Workshop that is not public', async () => {
    const rows = [
      approved(0, { workshop_id: DRAFT_WORKSHOP, workshop: { title: 'Draft', status: 'draft' } }),
      approved(1, { workshop_id: WORKSHOP, workshop: { title: 'Rapier', status: 'published' } }),
    ];
    const { service } = opened({ photos: rows });
    const tags = (await service.feed(EVENT, ANONYMOUS, {})).photos.map((photo) => photo.tag);
    expect(tags).toEqual([null, { kind: 'workshop', name: 'Rapier' }]);
  });

  it('filters by Tournament, or by Workshop', async () => {
    const rows = [
      approved(0, { tournament_id: TOURNAMENT, tournament: { name: 'Longsword Open' } }),
      approved(1, { workshop_id: WORKSHOP, workshop: { title: 'Rapier', status: 'published' } }),
      approved(2),
    ];
    const byTournament = opened({ photos: rows });
    const tournament = await byTournament.service.feed(EVENT, ANONYMOUS, {
      tournamentId: TOURNAMENT,
    });
    expect(tournament.photos.map((photo) => photo.id)).toEqual([rows[0]!['id']]);

    const byWorkshop = opened({ photos: rows });
    const workshop = await byWorkshop.service.feed(EVENT, ANONYMOUS, { workshopId: WORKSHOP });
    expect(workshop.photos.map((photo) => photo.id)).toEqual([rows[1]!['id']]);
    expect(filtersFor(byWorkshop.supabase.from, 'workshops', 'eq')).toEqual(
      expect.arrayContaining([
        ['id', WORKSHOP],
        ['event_id', EVENT],
      ]),
    );
  });

  it.each([
    ['a hidden Tournament', { tournamentId: HIDDEN_TOURNAMENT }],
    ['a Workshop that is not public', { workshopId: DRAFT_WORKSHOP }],
    ['a Workshop this Event does not hold', { workshopId: '66666666-6666-4666-8666-666666666666' }],
  ])('answers an empty page for a filter on %s, reading no photo', async (_what, query) => {
    const rows = [approved(0, { tournament_id: HIDDEN_TOURNAMENT, workshop_id: DRAFT_WORKSHOP })];
    const { service, supabase } = opened({ photos: rows });
    expect(await service.feed(EVENT, ANONYMOUS, query)).toEqual({ photos: [], next: null });
    expect(queriedTables(supabase.from)).not.toContain('event_photos');
  });

  it('answers an unknown Event and a hidden one with the same 404', async () => {
    const unknown = opened({ event: null });
    const hidden = opened({ event: { status: 'draft' } });
    const refusal = (read: Promise<unknown>) =>
      read.then(
        () => null,
        (error: { getStatus(): number; getResponse(): unknown }) => [
          error.getStatus(),
          error.getResponse(),
        ],
      );

    const a = await refusal(unknown.service.feed(EVENT, ANONYMOUS, {}));
    const b = await refusal(hidden.service.feed(EVENT, ANONYMOUS, {}));
    expect(a?.[0]).toBe(404);
    expect(a).toEqual(b);
  });

  it('gives a photo no links, never a refusal, with no bucket or a signer that fails', async () => {
    const row = approved(0);
    const none = opened({ photos: [row], store: null });
    expect((await none.service.feed(EVENT, ANONYMOUS, {})).photos[0]).toMatchObject({
      previewUrl: null,
      originalUrl: null,
    });

    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const failing = opened({ photos: [row], store: recordingStore(String(row['preview_key'])) });
    expect((await failing.service.feed(EVENT, ANONYMOUS, {})).photos[0]).toMatchObject({
      previewUrl: null,
      originalUrl: null,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not sign its links'));
  });
});
