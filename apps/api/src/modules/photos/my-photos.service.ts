import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { MyPhoto, MyPhotos } from '@myclash/types';
import { PHOTO_CLEANUP_QUEUE } from '../../workers/photo-cleanup.worker';
import { SupabaseService } from '../supabase/supabase.service';
import { accountPhotoName } from './photo-account';
import { PHOTO_STORE, type PhotoStore } from './photo-bucket';
import { requestDrain } from './photo-drain';
import { photoLinks } from './photo-links';
import { photoNotFound } from './photo-moderation.service';
import { PUBLIC_PHOTO_PAGE } from './photo-public.service';
import { photoTag, type PhotoTagEmbeds } from './photo-tag';
import { photoSendOpen } from './photo-window';

interface MyPhotoRow extends PhotoTagEmbeds {
  id: string;
  status: 'waiting' | 'approved';
  caption: string | null;
  created_at: string;
  preview_key: string;
  original_key: string;
}

/**
 * The photos she sent from her personal space (design Goal 11, slice 6a), read and deleted by her
 * account alone: every read and write is scoped to `uploader_user_id`, so another person's photo,
 * a QR photo or another Event's is "not found" to her. No membership check: a person who left
 * the Event may still delete what she sent.
 */
@Injectable()
export class MyPhotosService {
  private readonly logger = new Logger(MyPhotosService.name);

  constructor(
    private readonly supabase: SupabaseService,
    @Inject(PHOTO_STORE) private readonly store: PhotoStore | null,
    @InjectQueue(PHOTO_CLEANUP_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * One page of her photos of this Event, newest first, 30 at a time as the public list (one read
   * could be cut at PostgREST's 1000 rows), with the name they carry.
   */
  async list(eventId: string, userId: string, before?: string): Promise<MyPhotos> {
    let read = this.supabase.service
      .from('event_photos')
      .select(
        'id, status, caption, created_at, preview_key, original_key, tournament:tournaments(name), workshop:workshops(title)',
      )
      .eq('event_id', eventId)
      .eq('uploader_user_id', userId);
    if (before) read = read.lt('created_at', before);
    const [{ data, error }, sendOpen] = await Promise.all([
      read.order('created_at', { ascending: false }).limit(PUBLIC_PHOTO_PAGE),
      this.sendOpen(eventId),
    ]);
    if (error) throw new Error(`Her photos not read: ${error.message}`);
    const rows = (data ?? []) as unknown as MyPhotoRow[];
    const now = new Date();
    const photos = await Promise.all(rows.map((row) => this.photoOf(row, now)));
    const last = rows.length === PUBLIC_PHOTO_PAGE ? rows[rows.length - 1] : undefined;
    return {
      posterName: await accountPhotoName(this.supabase, userId),
      sendOpen,
      photos,
      next: last ? last.created_at : null,
    };
  }

  /** Deletes her photo; its images are queued by the row trigger, and the drain asked for now. */
  async remove(eventId: string, photoId: string, userId: string): Promise<void> {
    const { data, error } = await this.supabase.service
      .from('event_photos')
      .delete()
      .eq('id', photoId)
      .eq('event_id', eventId)
      .eq('uploader_user_id', userId)
      .select('id');
    if (error) throw new Error(error.message);
    if (!data?.length) throw photoNotFound();
    requestDrain(this.queue, this.logger, photoId);
  }

  /**
   * Whether her form can send now (ruling 463): the upload door's rule, and not archived (the
   * Event lock refuses an archived Event's uploads before the door). No Event: not open.
   */
  private async sendOpen(eventId: string): Promise<boolean> {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('status, start_date, end_date, timezone, photo_mode')
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw new Error(`Her Event not read: ${error.message}`);
    const event = data as (Parameters<typeof photoSendOpen>[0] & { status: string }) | null;
    return event !== null && event.status !== 'archived' && photoSendOpen(event, new Date());
  }

  private async photoOf(row: MyPhotoRow, now: Date): Promise<MyPhoto> {
    return {
      id: row.id,
      status: row.status,
      caption: row.caption,
      tag: photoTag(row),
      createdAt: row.created_at,
      ...(await photoLinks(this.store, row, now, this.logger)),
    };
  }
}
