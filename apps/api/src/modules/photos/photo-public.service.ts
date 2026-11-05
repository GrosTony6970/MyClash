import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  asPhotoMode,
  PHOTO_REPORT_LIMIT,
  PHOTO_REPORTS_PER_HOUR,
  PHOTO_REPORTS_PER_PHOTO,
  photosShown,
  type PublicPhoto,
  type PublicPhotoPage,
} from '@myclash/types';
import {
  type CompetitionEvent,
  hiddenTournamentIds,
  type PublicReader,
  readableEvent,
} from '../../common/auth/competition-visibility';
import { eventNotFound } from '../../common/auth/event-read-gate';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import { PUBLIC_WORKSHOP_STATUSES } from '../workshops/workshop-visibility';
import { PHOTO_STORE, type PhotoStore } from './photo-bucket';
import { photoLinks } from './photo-links';
import { photoNotFound } from './photo-moderation.service';
import { photoEvent } from './photo-organiser';
import type { PublicPhotoQuery } from './photo-public.dto';
import { photoDeletionInstant } from './photo-window';

/** Photos per page of the public list: a phone shows about six at once. */
export const PUBLIC_PHOTO_PAGE = 30;

const EMPTY: PublicPhotoPage = { photos: [], next: null };
const HOUR_MS = 60 * 60 * 1000;
/** Postgres: the photo a report names is gone (deleted between the check and the write). */
const FOREIGN_KEY_VIOLATION = '23503';

interface FeedRow {
  id: string;
  uploader_name: string | null;
  caption: string | null;
  created_at: string;
  preview_key: string;
  original_key: string;
  tournament_id: string | null;
  tournament: { name: string } | null;
  workshop: { title: string; status: string } | null;
}

/**
 * The public side of Event photos (design, "The public"): the list of approved photos, and the
 * Report. Both start from an Event the caller may see (`readableEvent`: a draft or test Event only
 * for its insiders), then close while photos are Off and from the deletion instant on. A waiting
 * photo never leaves here: the list reads approved rows only, and a Report of one answers as for a
 * photo that does not exist.
 */
@Injectable()
export class PhotoPublicService {
  private readonly logger = new Logger(PhotoPublicService.name);
  /** The clock of the deletion instant, the Report's hour and the links. Tests set it. */
  now: () => Date = () => new Date();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
    @Inject(PHOTO_STORE) private readonly store: PhotoStore | null,
  ) {}

  /**
   * One page of the Event's approved photos, newest first. `before` is the previous page's cursor:
   * a row's `created_at` exactly as the database wrote it. A tag the caller may not read is
   * dropped, the photo kept; a filter on one answers an empty page.
   */
  async feed(
    eventId: string,
    reader: PublicReader,
    query: PublicPhotoQuery,
  ): Promise<PublicPhotoPage> {
    const now = this.now();
    const competition = await this.openEvent(eventId, reader, now);
    if (!competition) return EMPTY;
    const hidden = await hiddenTournamentIds(this.deps(), competition, reader);
    if (await this.filterHidden(eventId, hidden, query)) return EMPTY;

    let read = this.supabase.service
      .from('event_photos')
      .select(
        'id, uploader_name, caption, created_at, preview_key, original_key, tournament_id, tournament:tournaments(name), workshop:workshops(title, status)',
      )
      .eq('event_id', eventId)
      .eq('status', 'approved');
    if (query.tournamentId) read = read.eq('tournament_id', query.tournamentId);
    if (query.workshopId) read = read.eq('workshop_id', query.workshopId);
    if (query.before) read = read.lt('created_at', query.before);
    const { data, error } = await read
      .order('created_at', { ascending: false })
      .limit(PUBLIC_PHOTO_PAGE);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as unknown as FeedRow[];
    const photos = await Promise.all(rows.map((row) => this.photoOf(row, hidden, now)));
    const last = rows.length === PUBLIC_PHOTO_PAGE ? rows[rows.length - 1] : undefined;
    return { photos, next: last ? last.created_at : null };
  }

  /**
   * A phone's Report of a public photo: one per phone and photo, a repeat adds no report (the
   * table's key). The photo stays visible. A photo the caller cannot see in the list answers 404.
   * A photo holding 20 other phones' reports takes no new phone, and the phone is told "reported"
   * all the same (ruling 449); a phone among them may still change its comment (453). The hour's
   * count and the write are two statements: taps sent at the same instant can pass a limit by a
   * few, which a convenience limit allows.
   */
  async report(
    eventId: string,
    photoId: string,
    deviceId: string,
    reader: PublicReader,
    comment: string | null,
  ): Promise<{ reported: true }> {
    const now = this.now();
    if (!(await this.openEvent(eventId, reader, now))) throw photoNotFound();
    const { data, error } = await this.supabase.service
      .from('event_photos')
      .select('id')
      .eq('id', photoId)
      .eq('event_id', eventId)
      .eq('status', 'approved')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw photoNotFound();

    await this.checkReportLimit(deviceId, now);
    if (await this.photoIsFull(photoId, deviceId)) return { reported: true };
    const reports = this.supabase.service.from('event_photo_reports');
    // With a comment, the key's row takes it, replacing the phone's last one (453); without, a
    // repeat is ignored, so an empty Report never erases a comment. `created_at` is never sent.
    const { error: written } = comment
      ? await reports.upsert(
          { photo_id: photoId, device_id: deviceId, comment },
          { onConflict: 'photo_id,device_id' },
        )
      : await reports.upsert(
          { photo_id: photoId, device_id: deviceId },
          { onConflict: 'photo_id,device_id', ignoreDuplicates: true },
        );
    if (written?.code === FOREIGN_KEY_VIOLATION) throw photoNotFound();
    if (written) throw new Error(written.message);
    return { reported: true };
  }

  /**
   * The Event, when the caller may see it and its photos are showing: null while photos are Off
   * (or the stored mode is unknown) and from the deletion instant on. An unknown Event answers
   * as a hidden one, in the same words (rulings 81-83).
   */
  private async openEvent(
    eventId: string,
    reader: PublicReader,
    now: Date,
  ): Promise<CompetitionEvent | null> {
    const competition = await readableEvent(this.deps(), eventId, reader);
    if (!competition) throw eventNotFound(eventId);
    const photos = await photoEvent(this.supabase, eventId);
    const mode = asPhotoMode(photos.photo_mode);
    if (!photosShown(mode)) return null;
    const deletion = photoDeletionInstant(photos);
    if (deletion && now.getTime() >= deletion.getTime()) return null;
    return competition;
  }

  /** Is the filter on a Tournament hidden from the caller, or a Workshop that is not public? */
  private async filterHidden(
    eventId: string,
    hidden: Set<string>,
    query: PublicPhotoQuery,
  ): Promise<boolean> {
    if (query.tournamentId) return hidden.has(query.tournamentId);
    if (!query.workshopId) return false;
    const { data, error } = await this.supabase.service
      .from('workshops')
      .select('status')
      .eq('id', query.workshopId)
      .eq('event_id', eventId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const status = (data as { status?: string } | null)?.status;
    return !status || !PUBLIC_WORKSHOP_STATUSES.includes(status);
  }

  /** Before the write: the phone's reports of the last hour, a repeat of one photo included. */
  private async checkReportLimit(deviceId: string, now: Date): Promise<void> {
    const { count, error } = await this.supabase.service
      .from('event_photo_reports')
      .select('photo_id', { count: 'exact', head: true })
      .eq('device_id', deviceId)
      .gte('created_at', new Date(now.getTime() - HOUR_MS).toISOString());
    if (error) throw new Error(error.message);
    if ((count ?? 0) >= PHOTO_REPORTS_PER_HOUR) {
      throw new HttpException(
        { message: 'This phone has reported its photos for this hour.', code: PHOTO_REPORT_LIMIT },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Does the photo hold its reports already (ruling 449)? Counted without this phone, whose own
   * row may change its comment (453) and is never a new one.
   */
  private async photoIsFull(photoId: string, deviceId: string): Promise<boolean> {
    const { count, error } = await this.supabase.service
      .from('event_photo_reports')
      .select('device_id', { count: 'exact', head: true })
      .eq('photo_id', photoId)
      .neq('device_id', deviceId);
    if (error) throw new Error(error.message);
    return (count ?? 0) >= PHOTO_REPORTS_PER_PHOTO;
  }

  private async photoOf(row: FeedRow, hidden: Set<string>, now: Date): Promise<PublicPhoto> {
    return {
      id: row.id,
      uploaderName: row.uploader_name,
      caption: row.caption,
      tag: tagOf(row, hidden),
      createdAt: row.created_at,
      ...(await photoLinks(this.store, row, now, this.logger)),
    };
  }

  private deps() {
    return { supabase: this.supabase, orgs: this.orgs };
  }
}

/** The photo's tag, unless it names a Tournament hidden from the caller or a Workshop not public. */
function tagOf(row: FeedRow, hidden: Set<string>): PublicPhoto['tag'] {
  if (row.tournament) {
    return row.tournament_id && hidden.has(row.tournament_id)
      ? null
      : { kind: 'tournament', name: row.tournament.name };
  }
  if (row.workshop && PUBLIC_WORKSHOP_STATUSES.includes(row.workshop.status)) {
    return { kind: 'workshop', name: row.workshop.title };
  }
  return null;
}
