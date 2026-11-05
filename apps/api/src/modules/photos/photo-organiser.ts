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
 * The select is one literal, so the schema-conformance sweep reads its columns.
 */
export async function organisersEvent(
  supabase: SupabaseService,
  orgs: OrganizationsService,
  eventId: string,
  userId: string,
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
  const event = data as PhotoEventRow;
  await orgs.assertOrgRole(event.organization_id, userId, 'admin');
  return event;
}
