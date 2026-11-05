import { NotFoundException } from '@nestjs/common';
import type { OrganizationsService } from '../organizations/organizations.service';
import type { SupabaseService } from '../supabase/supabase.service';

/** The Event columns the organiser's photo routes read: the link and the moderation queue. */
export interface PhotoEventRow {
  id: string;
  organization_id: string;
  slug: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  timezone: unknown;
  photo_mode: string;
  photo_token_version: number;
}

/**
 * The Event, once its caller is shown to be an admin of the Event's club, as `PATCH events/:id`
 * requires. The one gate of every organiser photo route: the QR link and the moderation queue.
 */
export async function organisersEvent(
  supabase: SupabaseService,
  orgs: OrganizationsService,
  eventId: string,
  userId: string,
): Promise<PhotoEventRow> {
  const event = await photoEvent(supabase, eventId);
  await orgs.assertOrgRole(event.organization_id, userId, 'admin');
  return event;
}

/**
 * The Event's photo columns, or 404. No gate: each caller holds one (the organiser's above, the
 * `photos` staff job's in `PhotoModerationService.eventForStaff`, and the public list's and
 * Report's `readableEvent` in `PhotoPublicService`). The select is one literal, so
 * the schema-conformance sweep reads its columns.
 */
export async function photoEvent(
  supabase: SupabaseService,
  eventId: string,
): Promise<PhotoEventRow> {
  const { data, error } = await supabase.service
    .from('events')
    .select(
      'id, organization_id, slug, name, start_date, end_date, timezone, photo_mode, photo_token_version',
    )
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new NotFoundException('Event not found');
  return data as PhotoEventRow;
}
