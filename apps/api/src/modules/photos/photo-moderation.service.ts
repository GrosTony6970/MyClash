import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { FastifyRequest } from 'fastify';
import {
  asPhotoMode,
  PHOTO_NOT_FOUND,
  type ModerationPhoto,
  type PhotoQueueFilter,
  type PhotoQueuePage,
  type PhotoSummary,
} from '@myclash/types';
import { eventZone } from '../../common/event-clock';
import { PHOTO_CLEANUP_QUEUE } from '../../workers/photo-cleanup.worker';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import { PHOTO_STORE, type PhotoStore } from './photo-bucket';
import { requestDrain } from './photo-drain';
import { photoTag } from './photo-tag';
import { photoLinks } from './photo-links';
import { StaffService } from '../staff/staff.service';
import { organisersEvent, photoEvent, type PhotoEventRow } from './photo-organiser';
import { EVENT_PHOTO_BYTES, EVENT_PHOTOS_PER_HOUR } from './photo-upload.service';
import { photoDeletionInstant } from './photo-window';

/** Photos per page of the queue. */
export const PHOTO_QUEUE_PAGE = 60;

/** `event_photo_usage` also counts one device; the queue asks for none. */
const NO_DEVICE = '00000000-0000-0000-0000-000000000000';

interface QueueRow {
  id: string;
  status: 'waiting' | 'approved';
  uploader_name: string | null;
  caption: string | null;
  created_at: string;
  preview_key: string;
  original_key: string;
  tournament: { name: string } | null;
  workshop: { title: string } | null;
  /**
   * A to-many embed: always an array, `[]` with no report (0252's key is composite). `updated_at`
   * is the report's last change: its time, or when its comment changed (0255).
   */
  reports: { comment: string | null; updated_at: string }[];
}

/** The photo is not, or no longer, in this Event: the moderators' and the Report's 404. */
export const photoNotFound = () =>
  new NotFoundException({ message: 'This photo is not in this Event.', code: PHOTO_NOT_FOUND });

/** The staff job that moderates photos (design, "Moderation"). */
const PHOTO_STAFF_ROLES = ['photos'] as const;

/**
 * The moderation queue (design, "Moderation"): what the Event has received and what the public
 * reported (each photo with its reports' count and comments), approve, keep, delete. Two
 * gates hand the calls their Event: `eventForOrganiser` (org admin, the admin page) and
 * `eventForStaff` (a staff login with the `photos` job, the staff app, on the login's own Event).
 * A call never takes an Event that did not come through one of them.
 *
 * A delete removes the row; the 0250 trigger queues both images, and a drain job queued here
 * takes them out of the bucket now rather than at the next 5-minute tick.
 */
@Injectable()
export class PhotoModerationService {
  private readonly logger = new Logger(PhotoModerationService.name);
  /** The clock of the deletion instant and of the links. Tests set it. */
  now: () => Date = () => new Date();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
    private readonly staff: StaffService,
    @Inject(PHOTO_STORE) private readonly store: PhotoStore | null,
    @InjectQueue(PHOTO_CLEANUP_QUEUE) private readonly queue: Queue,
  ) {}

  /** The organiser's gate: an admin of the Event's club. */
  eventForOrganiser(eventId: string, userId: string): Promise<PhotoEventRow> {
    return organisersEvent(this.supabase, this.orgs, eventId, userId);
  }

  /**
   * The staff gate: a staff session with the `photos` job, active, on an Event that is not
   * archived (completed is open to this job, ruling 437). The Event is the session's own: a staff
   * route names none.
   */
  async eventForStaff(req: FastifyRequest): Promise<PhotoEventRow> {
    const staff = await this.staff.requireStaffWithRole(req, PHOTO_STAFF_ROLES);
    return photoEvent(this.supabase, staff.event_id);
  }

  async summary(event: PhotoEventRow): Promise<PhotoSummary> {
    // From the deletion instant on the queue is empty, so its count says so too.
    const expired = this.expired(event, this.now());
    const [usage, waiting, reported] = await Promise.all([
      this.usage(event.id),
      expired ? 0 : this.waiting(event.id),
      expired ? 0 : this.reported(event.id),
    ]);
    const mode = asPhotoMode(event.photo_mode);
    if (!mode) throw new Error(`Event ${event.id}: unknown photo mode ${event.photo_mode}`);
    return {
      mode,
      eventSlug: event.slug,
      eventName: event.name,
      storage: this.store ? 'on' : 'off',
      lastHour: usage.lastHour,
      perHourCap: EVENT_PHOTOS_PER_HOUR,
      bytes: usage.bytes,
      bytesCap: EVENT_PHOTO_BYTES,
      waiting,
      reported,
      deletesAt: photoDeletionInstant(event)?.toISOString() ?? null,
      timezone: eventZone(event.timezone).zone,
    };
  }

  /**
   * One page of the queue, newest first. `before` is the previous page's cursor: a row's
   * `created_at` exactly as the database wrote it, never re-formatted, so no row is skipped.
   * From the deletion instant on the queue is empty: the expiry job is removing those images.
   */
  async list(
    event: PhotoEventRow,
    filter: PhotoQueueFilter,
    before?: string,
  ): Promise<PhotoQueuePage> {
    const now = this.now();
    if (this.expired(event, now)) return { photos: [], next: null };

    let query = this.queueRead(event.id, filter);
    if (filter === 'waiting') query = query.eq('status', 'waiting');
    if (before) query = query.lt('created_at', before);
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(PHOTO_QUEUE_PAGE);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as unknown as QueueRow[];
    const photos = await Promise.all(rows.map((row) => this.photoOf(row, now)));
    const last = rows.length === PHOTO_QUEUE_PAGE ? rows[rows.length - 1] : undefined;
    return { photos, next: last ? last.created_at : null };
  }

  /** Shown to the public from now on. Approving an approved photo changes nothing. */
  async approve(
    event: PhotoEventRow,
    photoId: string,
  ): Promise<{ id: string; status: 'approved' }> {
    const { data, error } = await this.supabase.service
      .from('event_photos')
      .update({ status: 'approved' })
      .eq('id', photoId)
      .eq('event_id', event.id)
      .select('id');
    if (error) throw new Error(error.message);
    if (!data?.length) throw photoNotFound();
    return { id: photoId, status: 'approved' };
  }

  /**
   * Keep: the photo stays, the reports the moderator saw go. `reportsUpTo` is the newest report
   * change the screen showed, as the database wrote it; a report made or whose comment changed
   * after it stays, unread, and keeps the photo in Reported (rulings 457, 466). A later report
   * counts again (448), as the table's key is free once more. A photo with no report changes
   * nothing.
   */
  async keep(
    event: PhotoEventRow,
    photoId: string,
    reportsUpTo: string,
  ): Promise<{ id: string; kept: true }> {
    const { data, error } = await this.supabase.service
      .from('event_photos')
      .select('id')
      .eq('id', photoId)
      .eq('event_id', event.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw photoNotFound();
    const { error: cleared } = await this.supabase.service
      .from('event_photo_reports')
      .delete()
      .eq('photo_id', photoId)
      .lte('updated_at', reportsUpTo);
    if (cleared) throw new Error(cleared.message);
    return { id: photoId, kept: true };
  }

  /** Deletes the photo. Its images are queued by the row trigger; the drain is asked for now. */
  async remove(event: PhotoEventRow, photoId: string): Promise<void> {
    const { data, error } = await this.supabase.service
      .from('event_photos')
      .delete()
      .eq('id', photoId)
      .eq('event_id', event.id)
      .select('id');
    if (error) throw new Error(error.message);
    if (!data?.length) throw photoNotFound();
    requestDrain(this.queue, this.logger, photoId);
  }

  /**
   * The queue's read of one Event, each photo with its reports. Reported embeds them `!inner`, so
   * PostgREST lists only photos with one. Two whole literals, so the schema-conformance sweep
   * reads both (`supabase-query-scan.ts`: a select built from a constant is skipped).
   */
  private queueRead(eventId: string, filter: PhotoQueueFilter) {
    const photos = this.supabase.service.from('event_photos');
    const read =
      filter === 'reported'
        ? photos.select(
            'id, status, uploader_name, caption, created_at, preview_key, original_key, tournament:tournaments(name), workshop:workshops(title), reports:event_photo_reports!inner(comment, updated_at)',
          )
        : photos.select(
            'id, status, uploader_name, caption, created_at, preview_key, original_key, tournament:tournaments(name), workshop:workshops(title), reports:event_photo_reports(comment, updated_at)',
          );
    return read.eq('event_id', eventId);
  }

  private expired(event: PhotoEventRow, now: Date): boolean {
    const instant = photoDeletionInstant(event);
    return instant !== null && now.getTime() >= instant.getTime();
  }

  private async photoOf(row: QueueRow, now: Date): Promise<ModerationPhoto> {
    // Newest change first (an edited comment rises, 466), compared as written (all UTC, as
    // PostgREST answers), by code unit: a locale-aware compare may weigh the `+` and `.` of a time
    // differently.
    const reports = [...row.reports].sort((a, b) =>
      a.updated_at === b.updated_at ? 0 : a.updated_at < b.updated_at ? 1 : -1,
    );
    return {
      id: row.id,
      status: row.status,
      uploaderName: row.uploader_name,
      caption: row.caption,
      tag: photoTag(row),
      createdAt: row.created_at,
      ...(await photoLinks(this.store, row, now, this.logger)),
      reportCount: reports.length,
      reportComments: reports.flatMap((report) => (report.comment ? [report.comment] : [])),
      lastReportAt: reports[0]?.updated_at ?? null,
    };
  }

  private async usage(eventId: string): Promise<{ lastHour: number; bytes: number }> {
    const { data, error } = await this.supabase.service.rpc('event_photo_usage', {
      p_event_id: eventId,
      p_device_id: NO_DEVICE,
    });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as {
      event_last_hour: number;
      event_bytes: number | string;
    };
    return { lastHour: row.event_last_hour, bytes: Number(row.event_bytes) };
  }

  private async waiting(eventId: string): Promise<number> {
    const { count, error } = await this.supabase.service
      .from('event_photos')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('status', 'waiting');
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  /** The photos with at least one report: `!inner` counts each photo once, however many it holds. */
  private async reported(eventId: string): Promise<number> {
    const { count, error } = await this.supabase.service
      .from('event_photos')
      .select('id, event_photo_reports!inner(photo_id)', { count: 'exact', head: true })
      .eq('event_id', eventId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }
}
