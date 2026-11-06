import { Readable } from 'node:stream';
import { GoneException, Inject, Injectable, Logger } from '@nestjs/common';
import type { CsvFormat } from '@myclash/types';
import { eventZone } from '../../common/event-clock';
import { zipStream } from '../../common/stored-zip';
import { SupabaseService } from '../supabase/supabase.service';
import { PHOTO_STORE, type PhotoStore } from './photo-bucket';
import { photoEntries, type DownloadRow } from './photo-download';
import type { PhotoEventRow } from './photo-organiser';
import { photosUnavailable } from './photo-refusals';
import { photosExpired } from './photo-window';

/** PostgREST answers at most 1,000 rows (`PGRST_DB_MAX_ROWS`): the rows are read a page at a time. */
export const PHOTO_DOWNLOAD_PAGE = 1000;

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

  constructor(
    private readonly supabase: SupabaseService,
    @Inject(PHOTO_STORE) private readonly store: PhotoStore | null,
  ) {}

  async zip(
    event: PhotoEventRow,
    filter: PhotoDownloadFilter,
    format: CsvFormat,
  ): Promise<{ filename: string; body: Readable }> {
    if (!this.store) throw photosUnavailable();
    if (photosExpired(event, this.now())) {
      throw new GoneException('The photos of this Event are deleted.');
    }
    const rows = await this.rows(event.id, filter);
    const stop = new AbortController();
    const warn = (message: string) => this.logger.warn(message);
    const zone = eventZone(event.timezone).zone;
    const chunks = zipStream(photoEntries(rows, this.store, zone, format, warn, stop.signal));
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
 */
function streamOf(
  source: AsyncGenerator<Buffer>,
  stop: AbortController,
  fault: (err: Error) => void,
): Readable {
  return new Readable({
    objectMode: true,
    highWaterMark: 1,
    read() {
      source.next().then(
        ({ value, done }) => this.push(done ? null : value),
        (err: Error) => {
          fault(err);
          this.destroy(err);
        },
      );
    },
    destroy(err, done) {
      stop.abort();
      source.return(undefined).then(
        () => done(err),
        () => done(err),
      );
    },
  });
}

async function* startingWith(first: Buffer, rest: AsyncGenerator<Buffer>): AsyncGenerator<Buffer> {
  yield first;
  yield* rest;
}
