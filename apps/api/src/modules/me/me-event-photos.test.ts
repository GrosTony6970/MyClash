import { describe, expect, it } from 'vitest';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { withOwnPhotos } from './me-event-photos';
import type { MyEvent } from './me-events.service';

/**
 * "Has she photos there?" per listed Event, for the personal space's Photos tab (design, "Where
 * it shows up" item 5). Only an Event whose photos are not yet deleted can hold one, so only
 * those are asked, each with a one-row read (a single read of all could be cut at 1000 rows).
 */
const UID = 'uid-1';
const NOW = new Date('2026-11-10T12:00:00Z');

const entry = (id: string, endDate: string | null): MyEvent =>
  ({ event: { id, endDate, timezone: 'Europe/Paris' } }) as unknown as MyEvent;

function read(rows: Record<string, unknown>[]) {
  const db = mockSupabase({ event_photos: { rows } });
  return { db, run: (events: MyEvent[]) => withOwnPhotos(db as never, events, UID, NOW) };
}

describe('withOwnPhotos', () => {
  it('marks the Events where she has photos', async () => {
    const { db, run } = read([
      { id: 'ph-1', event_id: 'e-mine', uploader_user_id: UID },
      { id: 'ph-2', event_id: 'e-theirs', uploader_user_id: 'uid-2' },
    ]);
    const marked = await run([entry('e-mine', '2026-11-08'), entry('e-theirs', '2026-11-08')]);
    expect(marked.map((m) => [m.event.id, m.hasMyPhotos])).toEqual([
      ['e-mine', true],
      ['e-theirs', false],
    ]);
    expect(selectsFor(db.from, 'event_photos')).toEqual(['id', 'id']);
    expect(filtersFor(db.from, 'event_photos', 'eq')).toEqual([
      ['event_id', 'e-mine'],
      ['uploader_user_id', UID],
      ['event_id', 'e-theirs'],
      ['uploader_user_id', UID],
    ]);
    expect(filtersFor(db.from, 'event_photos', 'limit')).toEqual([[1], [1]]);
  });

  it('an Event past its deletion instant is false with no read', async () => {
    const { db, run } = read([{ id: 'ph-1', event_id: 'e-old', uploader_user_id: UID }]);
    const [marked] = await run([entry('e-old', '2026-09-01')]);
    expect(marked?.hasMyPhotos).toBe(false);
    expect(db.from).not.toHaveBeenCalled();
  });

  it('an Event with no end date is asked', async () => {
    const { run } = read([{ id: 'ph-1', event_id: 'e-undated', uploader_user_id: UID }]);
    const [marked] = await run([entry('e-undated', null)]);
    expect(marked?.hasMyPhotos).toBe(true);
  });

  it('reads nothing for no Events', async () => {
    const { db, run } = read([]);
    expect(await run([])).toEqual([]);
    expect(db.from).not.toHaveBeenCalled();
  });

  it('a failed read fails the list (ruling 461)', async () => {
    const db = mockSupabase({ event_photos: { data: null, error: { message: 'boom' } } });
    await expect(
      withOwnPhotos(db as never, [entry('e-1', '2026-11-08')], UID, NOW),
    ).rejects.toThrow('My events: photos not read: boom');
  });
});
