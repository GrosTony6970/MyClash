import { Injectable, Logger } from '@nestjs/common';
import { asPhotoMode, PLATFORM_PHOTO_EVENTS_MAX, type PlatformPhotoEvent } from '@myclash/types';
import { SupabaseService } from '../supabase/supabase.service';
import { PhotoModerationService } from './photo-moderation.service';
import type { PhotoEventRow } from './photo-organiser';

/** Events counted at once: each is two small counts. */
const COUNTS_AT_ONCE = 8;

/** Below PostgREST's own cut (`PGRST_DB_MAX_ROWS` 1000): a read that reaches it is logged. */
const READ_CAP = 999;

/**
 * The platform's Photos page (ruling 493): the Events whose photos are not Off, and those that
 * still hold photos (an Event turned Off keeps them until their deletion), newest first, each with
 * its club and what waits on a moderator. For a platform super admin only: the controller's guard.
 */
@Injectable()
export class PhotoPlatformService {
  private readonly logger = new Logger(PhotoPlatformService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly moderation: PhotoModerationService,
  ) {}

  async events(): Promise<PlatformPhotoEvent[]> {
    const ids = [...new Set([...(await this.photosOn()), ...(await this.holdingPhotos())])];
    if (ids.length === 0) return [];
    const events = await this.eventRows(ids);
    const clubs = await this.clubNames(events.map((event) => event.organization_id));
    const rows: PlatformPhotoEvent[] = [];
    for (let at = 0; at < events.length; at += COUNTS_AT_ONCE) {
      const batch = events.slice(at, at + COUNTS_AT_ONCE);
      rows.push(...(await Promise.all(batch.map((event) => this.rowOf(event, clubs)))));
    }
    return rows;
  }

  private async rowOf(
    event: PhotoEventRow,
    clubs: Map<string, string>,
  ): Promise<PlatformPhotoEvent> {
    const { waiting, reported } = await this.moderation.counts(event);
    const mode = asPhotoMode(event.photo_mode);
    // The column's CHECK allows only the known modes; an unknown one reads as Off so the list
    // stays up, and is logged.
    if (!mode) this.logger.warn(`Event ${event.id}: unknown photo mode ${event.photo_mode}`);
    return {
      id: event.id,
      name: event.name,
      clubName: clubs.get(event.organization_id) ?? null,
      startDate: event.start_date,
      endDate: event.end_date,
      mode: mode ?? 'off',
      waiting,
      reported,
    };
  }

  private async photosOn(): Promise<string[]> {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('id')
      .neq('photo_mode', 'off')
      .limit(READ_CAP);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { id: string }[];
    if (rows.length === READ_CAP)
      this.logger.warn(`${READ_CAP} Events take photos: the list is cut`);
    return rows.map((row) => row.id);
  }

  /** Only the service role may call this function (0250): a wrong key fails here, never empty. */
  private async holdingPhotos(): Promise<string[]> {
    const { data, error } = await this.supabase.service.rpc('event_photo_events');
    if (error) throw new Error(error.message);
    return ((data ?? []) as { event_id: string }[]).map((row) => row.event_id);
  }

  /** The Events, newest first (an Event with no date last), with the columns the gates read. */
  private async eventRows(ids: string[]): Promise<PhotoEventRow[]> {
    const { data, error } = await this.supabase.service
      .from('events')
      .select(
        'id, organization_id, slug, name, start_date, end_date, timezone, photo_mode, photo_token_version',
      )
      .in('id', ids)
      .order('start_date', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .limit(PLATFORM_PHOTO_EVENTS_MAX);
    if (error) throw new Error(error.message);
    return (data ?? []) as PhotoEventRow[];
  }

  private async clubNames(orgIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(orgIds)];
    if (unique.length === 0) return new Map();
    const { data, error } = await this.supabase.service
      .from('organizations')
      .select('id, name')
      .in('id', unique);
    if (error) throw new Error(error.message);
    return new Map(((data ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name]));
  }
}
