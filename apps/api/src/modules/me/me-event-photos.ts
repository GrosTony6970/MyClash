import { photoDeletionInstant } from '../photos/photo-window';
import type { SupabaseService } from '../supabase/supabase.service';
import type { MyEvent } from './me-events.service';

/** A listed Event, and whether she sent it a photo from her personal space that still exists. */
export type MyEventWithPhotos = MyEvent & { hasMyPhotos: boolean };

/**
 * "Has she photos there?" for each listed Event, so the personal space can show its Photos tab
 * while photos are off (design, "Where it shows up" item 5).
 *
 * Photo rows are deleted at the Event's deletion instant, so only an Event before it is asked,
 * each with a one-row read: a single read of all her photos could be cut at PostgREST's 1000 rows
 * and drop an Event in silence. An Event with no end date has no instant and is asked. A failed
 * read fails the list (ruling 461).
 */
export async function withOwnPhotos(
  supabase: SupabaseService,
  events: MyEvent[],
  userId: string,
  now: Date,
): Promise<MyEventWithPhotos[]> {
  return Promise.all(
    events.map(async (entry) => {
      const instant = photoDeletionInstant({
        end_date: entry.event.endDate,
        timezone: entry.event.timezone,
      });
      if (instant !== null && instant.getTime() <= now.getTime()) {
        return { ...entry, hasMyPhotos: false };
      }
      const { data, error } = await supabase.service
        .from('event_photos')
        .select('id')
        .eq('event_id', entry.event.id)
        .eq('uploader_user_id', userId)
        .limit(1);
      if (error) throw new Error(`My events: photos not read: ${error.message}`);
      return { ...entry, hasMyPhotos: (data ?? []).length > 0 };
    }),
  );
}
