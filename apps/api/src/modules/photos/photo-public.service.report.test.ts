import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseChain } from '../../common/testing/supabase-chain';
import { writesTo } from '../../common/testing/supabase-chain';
import { EVENT, OTHER_EVENT, photoRow } from './testing/moderation-doubles';
import { ANONYMOUS, PHONE, publicPhotos } from './testing/public-doubles';

/**
 * A phone's Report of a public photo (design, "The public"): one per phone and photo, at most 30
 * photos an hour, never of a photo the public cannot see. The photo stays visible.
 */

const NOW = new Date('2026-11-07T15:02:00Z');
const DELETION = new Date('2026-12-08T23:00:00Z');
const PHOTO = photoRow(0)['id'] as string;
const OTHER_PHOTO = photoRow(1)['id'] as string;

const approved = (over = {}) => photoRow(0, { status: 'approved', ...over });

const OTHER_PHONE = '66666666-6666-4666-8666-666666666666';

/** `n` reports by a phone, the newest `ago` minutes back, one minute apart, as the bound's `…Z`. */
function reportsOf(n: number, ago = 1, phone = PHONE) {
  return Array.from({ length: n }, (_, i) => ({
    photo_id: `00000000-0000-4000-8000-${String(100 + i).padStart(12, '0')}`,
    device_id: phone,
    created_at: new Date(NOW.getTime() - (ago + i) * 60_000).toISOString(),
  }));
}

/** `n` reports of the photo, each by its own phone, a day back (out of every phone's hour). */
function reportsOfPhoto(n: number, photo = PHOTO) {
  return Array.from({ length: n }, (_, i) => ({
    photo_id: photo,
    device_id: `77777777-7777-4777-8777-${String(i).padStart(12, '0')}`,
    created_at: new Date(NOW.getTime() - 86_400_000).toISOString(),
  }));
}

function opened(options: Parameters<typeof publicPhotos>[0] = {}, now = NOW) {
  const doubles = publicPhotos({ photos: [approved()], ...options });
  doubles.service.now = () => now;
  return doubles;
}

/** Every `.upsert` call on `table`, with both its arguments: the double records the row only. */
function upsertCalls(from: ReturnType<typeof publicPhotos>['supabase']['from'], table: string) {
  return from.mock.calls.flatMap(([queried], index) => {
    const result = from.mock.results[index];
    if (queried !== table || result?.type !== 'return') return [];
    const chain = result.value as SupabaseChain & { upsert: { mock: { calls: unknown[][] } } };
    return chain.upsert.mock.calls;
  });
}

const refusal = (call: Promise<unknown>) =>
  call.then(
    () => null,
    (error: { getStatus(): number; getResponse(): unknown }) => [
      error.getStatus(),
      error.getResponse(),
    ],
  );

afterEach(() => vi.restoreAllMocks());

describe('a Report', () => {
  it('records one report per phone and photo, a repeat ignored by the key', async () => {
    const { service, supabase } = opened();

    expect(await service.report(EVENT, PHOTO, PHONE, ANONYMOUS)).toEqual({ reported: true });

    const [write] = writesTo(supabase, 'event_photo_reports');
    expect(write?.op).toBe('upsert');
    expect(upsertCalls(supabase.from, 'event_photo_reports')).toEqual([
      [
        { photo_id: PHOTO, device_id: PHONE },
        { onConflict: 'photo_id,device_id', ignoreDuplicates: true },
      ],
    ]);
  });

  it('asks for an approved photo of this Event', async () => {
    const { service, supabase } = opened();
    await service.report(EVENT, PHOTO, PHONE, ANONYMOUS);
    const photoRead = supabase.from.mock.results.find(
      (_result, i) => supabase.from.mock.calls[i]?.[0] === 'event_photos',
    )?.value as { eq: { mock: { calls: unknown[][] } } };
    expect(photoRead.eq.mock.calls).toEqual([
      ['id', PHOTO],
      ['event_id', EVENT],
      ['status', 'approved'],
    ]);
  });

  it('lets a phone report 30 photos in an hour, and refuses the 31st before writing', async () => {
    // Another phone's 30 reports of the same hour do not count against this one.
    const under = opened({ reports: [...reportsOf(29), ...reportsOf(30, 1, OTHER_PHONE)] });
    await expect(under.service.report(EVENT, PHOTO, PHONE, ANONYMOUS)).resolves.toEqual({
      reported: true,
    });

    const at = opened({ reports: reportsOf(30) });
    const answer = await refusal(at.service.report(EVENT, PHOTO, PHONE, ANONYMOUS));
    expect(answer?.[0]).toBe(429);
    expect(answer?.[1]).toMatchObject({ code: 'photo_report_limit' });
    expect(writesTo(at.supabase, 'event_photo_reports')).toEqual([]);
  });

  it('counts only the last hour of the phone', async () => {
    // 30 reports, the newest 61 minutes back: none counts.
    const { service } = opened({ reports: reportsOf(30, 61) });
    await expect(service.report(EVENT, PHOTO, PHONE, ANONYMOUS)).resolves.toEqual({
      reported: true,
    });
  });

  it('refuses a phone at the limit even for a photo it already reported', async () => {
    const reports = [
      ...reportsOf(29),
      { photo_id: PHOTO, device_id: PHONE, created_at: NOW.toISOString() },
    ];
    const { service } = opened({ reports });
    expect((await refusal(service.report(EVENT, PHOTO, PHONE, ANONYMOUS)))?.[0]).toBe(429);
  });

  it('stores no more than 20 reports of one photo, and still answers "reported" (ruling 449)', async () => {
    const full = opened({ reports: reportsOfPhoto(20) });
    await expect(full.service.report(EVENT, PHOTO, PHONE, ANONYMOUS)).resolves.toEqual({
      reported: true,
    });
    expect(writesTo(full.supabase, 'event_photo_reports')).toEqual([]);

    // 19 of its own, and 20 of another photo: this one still takes its 20th.
    const reports = [...reportsOfPhoto(19), ...reportsOfPhoto(20, OTHER_PHOTO)];
    const room = opened({ reports });
    await room.service.report(EVENT, PHOTO, PHONE, ANONYMOUS);
    expect(writesTo(room.supabase, 'event_photo_reports')).toHaveLength(1);
  });

  it.each([
    ['a waiting photo', { photos: [photoRow(0)] }],
    ['another Event’s photo', { photos: [approved({ event_id: OTHER_EVENT })] }],
    ['a photo while photos are Off', { event: { photo_mode: 'off' } }],
    ['a photo under an unknown mode', { event: { photo_mode: 'sideways' } }],
  ])('answers 404 photo_not_found for %s, writing nothing', async (_what, options) => {
    const { service, supabase } = opened(options);
    const answer = await refusal(service.report(EVENT, PHOTO, PHONE, ANONYMOUS));
    expect(answer?.[0]).toBe(404);
    expect(answer?.[1]).toMatchObject({ code: 'photo_not_found' });
    expect(writesTo(supabase, 'event_photo_reports')).toEqual([]);
  });

  it('answers 404 photo_not_found from the deletion instant on', async () => {
    const before = opened({}, new Date(DELETION.getTime() - 1));
    await expect(before.service.report(EVENT, PHOTO, PHONE, ANONYMOUS)).resolves.toBeTruthy();

    const at = opened({}, DELETION);
    expect((await refusal(at.service.report(EVENT, PHOTO, PHONE, ANONYMOUS)))?.[0]).toBe(404);
  });

  it('answers 404 photo_not_found when the photo is deleted before the write lands', async () => {
    const { service } = opened({
      reportError: { code: '23503', message: 'insert violates foreign key constraint' },
    });
    const answer = await refusal(service.report(EVENT, PHOTO, PHONE, ANONYMOUS));
    expect(answer?.[0]).toBe(404);
    expect(answer?.[1]).toMatchObject({ code: 'photo_not_found' });
  });

  it('answers an unknown Event and a hidden one with the same 404', async () => {
    const a = await refusal(opened({ event: null }).service.report(EVENT, PHOTO, PHONE, ANONYMOUS));
    const b = await refusal(
      opened({ event: { event_kind: 'test' } }).service.report(EVENT, PHOTO, PHONE, ANONYMOUS),
    );
    expect(a?.[0]).toBe(404);
    expect(a).toEqual(b);
  });
});
