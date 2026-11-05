import type { Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { inListChunks } from '../../common/postgrest-in-list';
import { photoKeyParts, type PhotoStore } from './photo-bucket';
import { photoDeletionInstant } from './photo-window';

/** An object this old with no photo row is an orphan; a younger one may be an upload in flight. */
export const PHOTO_ORPHAN_GRACE_MS = 60 * 60_000;
/**
 * A key is about 100 characters once URL-encoded, so 75 keep the tombstone delete's `.in()` URL
 * near the 8 KB that `IN_LIST_MAX` gives 200 uuids.
 */
export const PHOTO_DRAIN_BATCH = 75;
/** A run stops here, inside the 5-minute tick; the next run goes on where it stopped. */
export const PHOTO_CLEANUP_RUN_MS = 4 * 60_000;

type Log = Pick<Logger, 'log' | 'warn' | 'error'>;
type Removal = { removed: string[]; failure: Error | null; stopped: boolean };

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Takes photo images out of the bucket on every path (design, "Storage and deletion"):
 * - `expire` deletes the photo rows of every Event at or past its deletion instant; the row
 *   trigger of migration 0250 queues their keys as tombstones;
 * - `drain` deletes each tombstoned object, then its tombstone. Object first: a tombstone never
 *   goes while its object may exist. A bucket failure stops the run, keeps the tombstone, is
 *   logged with the key and fails the job;
 * - `sweep` deletes every object at least `PHOTO_ORPHAN_GRACE_MS` old, of an Event this database
 *   holds, that no photo row names: an upload whose row was never written, or whose clean-up
 *   failed.
 *
 * The sweep judges only what it can see. A key of an Event this database does not hold, or in a
 * shape the upload never writes, is left alone: another stack given the same bucket keys must not
 * delete photos it knows nothing of. The bucket's 120-day expiry rule takes those. And it first
 * asks a question only the service role may ask: a wrong key reads the deny-all photo table as
 * empty, with no error, and every image would look orphaned.
 *
 * Every bucket call is bounded by the store; a run stops at `PHOTO_CLEANUP_RUN_MS`, checked
 * before each bucket call, and the next run goes on.
 *
 * The races, named:
 * - Two runs at once (the api and worker containers both run the jobs, and a slow run can meet
 *   the next tick): deleting a missing object and a missing tombstone are both no-ops.
 * - An upload in flight writes its objects first and its row last, within about 2 minutes: the
 *   sweep's hour of grace keeps it.
 * - An upload whose row lands after `expire` read it: its Event is still expired at the next tick.
 */
export class PhotoCleanup {
  constructor(
    private readonly db: SupabaseClient,
    private readonly store: PhotoStore | null,
    private readonly logger: Log,
    private readonly now: () => number = Date.now,
  ) {}

  /** One Event that fails does not hold up the others: each is tried, then the run fails. */
  async expire(): Promise<{ events: string[]; photos: number }> {
    const now = this.now();
    const events: string[] = [];
    const failures: string[] = [];
    let photos = 0;
    for (const row of await this.photoEvents('Photo expiry not read')) {
      const instant = photoDeletionInstant(row);
      if (!instant) {
        this.logger.warn(
          `Event ${row.event_id}: end date ${JSON.stringify(row.end_date)} not read; its photos are not expired`,
        );
        continue;
      }
      if (instant.getTime() > now) continue;
      const { data: gone, error } = await this.db
        .from('event_photos')
        .delete()
        .eq('event_id', row.event_id)
        .select('id');
      if (error) {
        failures.push(`Photos of Event ${row.event_id} not expired: ${error.message}`);
        continue;
      }
      const count = gone?.length ?? 0;
      this.logger.log(
        `Expired ${count} photos of Event ${row.event_id} (deletion instant ${instant.toISOString()})`,
      );
      events.push(row.event_id);
      photos += count;
    }
    if (failures.length > 0) throw new Error(failures.join('; '));
    return { events, photos };
  }

  async drain(): Promise<{ deleted: number }> {
    const deadline = this.now() + PHOTO_CLEANUP_RUN_MS;
    const done = new Set<string>();
    for (;;) {
      const keys = await this.tombstones();
      if (keys.length === 0) return { deleted: done.size };
      if (!this.store) {
        this.logger.warn('Photo images wait for deletion, but the photo bucket is not configured');
        return { deleted: done.size };
      }
      // A tombstone this run already cleared, read again: the delete hit nothing. Stop loudly
      // rather than delete the same objects until the deadline on every tick.
      const again = keys.find((key) => done.has(key));
      if (again) throw new Error(`Photo tombstone ${again} was cleared but is still there`);
      const { removed, failure, stopped } = await this.removeAll(keys, deadline, 'drain');
      if (failure) this.logger.error(failure.message);
      await this.forget(removed);
      for (const key of removed) done.add(key);
      if (failure) throw failure;
      if (stopped || keys.length < PHOTO_DRAIN_BATCH) return { deleted: done.size };
    }
  }

  async sweep(): Promise<{ deleted: number }> {
    if (!this.store) {
      // A stack with no bucket is a normal one: a plain line each hour, not a warning.
      this.logger.log('The photo bucket is not configured; no orphan sweep');
      return { deleted: 0 };
    }
    await this.photoEvents(
      'Orphan sweep refused: the photo rows cannot be read as the service role',
    );
    const deadline = this.now() + PHOTO_CLEANUP_RUN_MS;
    let deleted = 0;
    let next: string | undefined;
    do {
      if (this.pastDeadline(deadline, 'orphan sweep')) break;
      const page = await this.store.list('events/', next);
      next = page.next;
      if (page.undated > 0) {
        this.logger.warn(
          `${page.undated} listed photo bucket entries had no key or date; left alone`,
        );
      }
      const now = this.now();
      const old = page.objects.filter(
        (o) => now - o.lastModified.getTime() >= PHOTO_ORPHAN_GRACE_MS,
      );
      const { removed, failure, stopped } = await this.removeAll(
        await this.orphansOf(old.map((o) => o.key)),
        deadline,
        'orphan sweep',
      );
      for (const key of removed) this.logger.log(`Deleted orphan photo object ${key}`);
      deleted += removed.length;
      if (failure) {
        this.logger.error(failure.message);
        throw failure;
      }
      if (stopped) break;
    } while (next);
    return { deleted };
  }

  /**
   * The Events that hold photos. Only the service role may call this function (0250), so a wrong
   * key fails here instead of reading the deny-all photo table as empty.
   */
  private async photoEvents(
    what: string,
  ): Promise<Array<{ event_id: string; end_date: string; timezone: string }>> {
    const { data, error } = await this.db.rpc('event_photo_events');
    if (error) throw new Error(`${what}: ${error.message}`);
    return (data ?? []) as Array<{ event_id: string; end_date: string; timezone: string }>;
  }

  /** Removes `keys` in order until one fails or the deadline passes. */
  private async removeAll(keys: string[], deadline: number, step: string): Promise<Removal> {
    const removed: string[] = [];
    for (const key of keys) {
      if (this.pastDeadline(deadline, step)) return { removed, failure: null, stopped: true };
      try {
        await this.store!.remove(key);
      } catch (err) {
        const failure = new Error(`Photo ${step} stopped at ${key}: ${reason(err)}`);
        return { removed, failure, stopped: false };
      }
      removed.push(key);
    }
    return { removed, failure: null, stopped: false };
  }

  private pastDeadline(deadline: number, step: string): boolean {
    if (this.now() < deadline) return false;
    this.logger.warn(`Photo ${step} stopped at its deadline; the next run goes on`);
    return true;
  }

  private async tombstones(): Promise<string[]> {
    const { data, error } = await this.db
      .from('event_photo_tombstones')
      .select('object_key')
      .order('queued_at', { ascending: true })
      .limit(PHOTO_DRAIN_BATCH);
    if (error) throw new Error(`Photo tombstones not read: ${error.message}`);
    return ((data ?? []) as Array<{ object_key: string }>).map((row) => row.object_key);
  }

  /** The tombstones of objects already deleted. A failure here only means a second delete later. */
  private async forget(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const { error } = await this.db.from('event_photo_tombstones').delete().in('object_key', keys);
    if (error) {
      throw new Error(`Photo tombstones not cleared (their objects are gone): ${error.message}`);
    }
  }

  /** The keys of an Event this database holds that no photo row names. */
  private async orphansOf(keys: string[]): Promise<string[]> {
    const parsed = keys.flatMap((key) => {
      const parts = photoKeyParts(key);
      return parts ? [{ key, event: parts.eventId, photo: parts.photoId }] : [];
    });
    if (parsed.length < keys.length) {
      this.logger.warn(
        `${keys.length - parsed.length} photo bucket keys in an unknown shape left alone`,
      );
    }
    // Literal table names, so the schema-conformance test reads both queries.
    const events = await knownIds(
      'Events',
      parsed.map((p) => p.event),
      (chunk) => this.db.from('events').select('id').in('id', chunk),
    );
    const ours = parsed.filter((p) => events.has(p.event));
    if (ours.length < parsed.length) {
      this.logger.warn(
        `${parsed.length - ours.length} photo bucket keys of no Event here left alone`,
      );
    }
    const photos = await knownIds(
      'Photo rows',
      ours.map((p) => p.photo),
      (chunk) => this.db.from('event_photos').select('id').in('id', chunk),
    );
    return ours.filter((p) => !photos.has(p.photo)).map((p) => p.key);
  }
}

/** Which of `ids` the read finds, asked in the repo's `.in()` chunks. */
async function knownIds(
  what: string,
  ids: string[],
  read: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<Set<string>> {
  const known = new Set<string>();
  for (const chunk of inListChunks([...new Set(ids)])) {
    const { data, error } = await read(chunk);
    if (error) throw new Error(`${what} not read for the orphan sweep: ${error.message}`);
    for (const row of (data ?? []) as Array<{ id: string }>) known.add(row.id.toLowerCase());
  }
  return known;
}
