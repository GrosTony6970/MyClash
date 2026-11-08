import { Readable } from 'node:stream';
import { GoneException, Inject, Injectable, Logger } from '@nestjs/common';
import type { CsvFormat } from '@myclash/types';
import { eventZone } from '../../common/event-clock';
import { zipStream } from '../../common/stored-zip';
import { SupabaseService } from '../supabase/supabase.service';
import { PHOTO_STORE, type PhotoStore } from './photo-bucket';
import { photoEntries, type DownloadRow } from './photo-download';
import type { PhotoEventRow } from './photo-organiser';
import { downloadsBusy, photosUnavailable } from './photo-refusals';
import { photosExpired } from './photo-window';

/** PostgREST answers at most 1,000 rows (`PGRST_DB_MAX_ROWS`): the rows are read a page at a time. */
export const PHOTO_DOWNLOAD_PAGE = 1000;

/**
 * Zips made at once (ruling 497). Each holds up to ~36 MiB and one bucket connection, and the API
 * that makes them also serves scoring: 25 at once would fill its 1 GB. The counter lives in this
 * process; one API container serves HTTP (as `PHOTO_UPLOAD_SLOTS`).
 */
export const PHOTO_DOWNLOAD_SLOTS = 4;

/**
 * A zip whose reader takes nothing for this long is cut, so its slot frees. Without it a paused
 * browser download, or a laptop shut mid-download, holds its slot for as long as the connection
 * lives, and four of them refuse every organiser. Longer than a bucket read's 30 s timeout.
 */
export const PHOTO_DOWNLOAD_IDLE_MS = 120_000;

/** One Tournament's or one Workshop's photos; none set means every photo of the Event. */
export interface PhotoDownloadFilter {
  tournamentId?: string;
  workshopId?: string;
}

/**
 * "Download all" (design Goal 10): every stored original of the Event as one zip, streamed from
 * the bucket, never built in memory or on disk (rulings 467-470). The caller is the organiser's
 * gate (`PhotosController.organisersEvent`); this service takes only an Event that passed it.
 *
 * Every row is read before the answer starts, so a database fault is an ordinary error answer.
 * So is a bucket fault on the first photo: its read is pulled here, inside the request, where the
 * API's exception filter answers it. A fault after that cuts the connection, and the browser
 * reports a failed download (a zip whose directory never came is invalid anyway).
 */
@Injectable()
export class PhotoDownloadService {
  private readonly logger = new Logger(PhotoDownloadService.name);
  /** The clock of the deletion instant. Tests set it. */
  now: () => Date = () => new Date();
  private running = 0;

  constructor(
    private readonly supabase: SupabaseService,
    @Inject(PHOTO_STORE) private readonly store: PhotoStore | null,
  ) {}

  /** Every zip slot is taken: a zip asked for now is refused. */
  busy(): boolean {
    return this.running >= PHOTO_DOWNLOAD_SLOTS;
  }

  /**
   * A zip holds its slot from here until its body closes: read to the end, failed, the organiser
   * gone (Fastify destroys the body), or nothing taken for `PHOTO_DOWNLOAD_IDLE_MS`. A refusal or
   * a failure before the body frees it at once.
   */
  async zip(
    event: PhotoEventRow,
    filter: PhotoDownloadFilter,
    format: CsvFormat,
  ): Promise<{ filename: string; body: Readable }> {
    if (!this.store) throw photosUnavailable();
    if (photosExpired(event, this.now())) {
      throw new GoneException('The photos of this Event are deleted.');
    }
    if (this.busy()) {
      this.logger.warn(`Event ${event.id}: a photo download was refused, every slot is taken`);
      throw downloadsBusy();
    }
    this.running += 1;
    try {
      const zip = await this.start(event, filter, format, this.store);
      zip.body.once('close', () => (this.running -= 1));
      return zip;
    } catch (err) {
      this.running -= 1;
      throw err;
    }
  }

  private async start(
    event: PhotoEventRow,
    filter: PhotoDownloadFilter,
    format: CsvFormat,
    store: PhotoStore,
  ): Promise<{ filename: string; body: Readable }> {
    const rows = await this.rows(event.id, filter);
    const stop = new AbortController();
    const warn = (message: string) => this.logger.warn(message);
    const zone = eventZone(event.timezone).zone;
    const chunks = zipStream(photoEntries(rows, store, zone, format, warn, stop.signal));
    const first = await this.firstChunk(event.id, chunks);
    // After the first byte a fault only cuts the connection: the log is its one trace.
    const fault = (err: Error) =>
      this.logger.error(`Event ${event.id}: the photo download failed after it started`, err);
    return {
      filename: `${event.slug}-photos.zip`,
      body: streamOf(startingWith(first, chunks), stop, fault),
    };
  }

  private async firstChunk(eventId: string, chunks: AsyncGenerator<Buffer>): Promise<Buffer> {
    try {
      const { value } = await chunks.next();
      return value as Buffer;
    } catch (err) {
      this.logger.error(`Event ${eventId}: the photo download could not start`, err as Error);
      throw photosUnavailable();
    }
  }

  /** Every row of the Event (or of one tag), paged by id (unique: no row skipped), then by time. */
  private async rows(eventId: string, filter: PhotoDownloadFilter): Promise<DownloadRow[]> {
    const rows: DownloadRow[] = [];
    let after: string | undefined;
    for (;;) {
      let query = this.supabase.service
        .from('event_photos')
        .select(
          'id, status, uploader_name, caption, created_at, original_key, byte_size, crc32, tournament:tournaments(name), workshop:workshops(title)',
        )
        .eq('event_id', eventId);
      if (filter.tournamentId) query = query.eq('tournament_id', filter.tournamentId);
      if (filter.workshopId) query = query.eq('workshop_id', filter.workshopId);
      if (after) query = query.gt('id', after);
      const { data, error } = await query
        .order('id', { ascending: true })
        .limit(PHOTO_DOWNLOAD_PAGE);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as unknown as DownloadRow[];
      rows.push(...page);
      if (page.length < PHOTO_DOWNLOAD_PAGE) return rows.sort(byTime);
      after = page[page.length - 1]!.id;
    }
  }
}

/** Oldest first; the same instant falls back on the id. Times compared as the database wrote them. */
function byTime(a: DownloadRow, b: DownloadRow): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

/**
 * The answer's body: one chunk held at a time, the next pulled only when it is taken. Its destroy
 * (the organiser left, or the answer failed) stops the reads AT ONCE. `Readable.from` would say
 * so only on 'close', which waits for the source's return(), and that waits behind a bucket read
 * under way, so one more photo was read after the organiser left.
 *
 * A body nobody takes from for `PHOTO_DOWNLOAD_IDLE_MS` is destroyed as failed, so its zip slot
 * frees. The clock starts when the body is made, so a body Fastify never reads (the organiser
 * left before the first byte) is cut too.
 */
function streamOf(
  source: AsyncGenerator<Buffer>,
  stop: AbortController,
  fault: (err: Error) => void,
): Readable {
  let idle: NodeJS.Timeout | undefined;
  const wake = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      const err = new Error(`its reader took nothing for ${PHOTO_DOWNLOAD_IDLE_MS / 1000} s`);
      fault(err);
      body.destroy(err);
    }, PHOTO_DOWNLOAD_IDLE_MS).unref();
  };
  const body = new Readable({
    objectMode: true,
    highWaterMark: 1,
    read() {
      wake();
      source.next().then(
        ({ value, done }) => this.push(done ? null : value),
        (err: Error) => {
          fault(err);
          this.destroy(err);
        },
      );
    },
    destroy(err, done) {
      clearTimeout(idle);
      stop.abort();
      source.return(undefined).then(
        () => done(err),
        () => done(err),
      );
    },
  });
  wake();
  return body;
}

async function* startingWith(first: Buffer, rest: AsyncGenerator<Buffer>): AsyncGenerator<Buffer> {
  yield first;
  yield* rest;
}
