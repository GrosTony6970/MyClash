import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { readPlatformRole } from '../../common/auth/platform-role';
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
 * An Event handed over by a gate, with the gate's verdict on the audit log: the account a write
 * must record (a platform super admin moderating a club's photos, ruling 494), or `null` (the
 * club's own moderators, as before). Required, so a write cannot take an Event no gate passed.
 */
export type GatedPhotoEvent = PhotoEventRow & { auditActor: string | null };

/**
 * The Event, once its caller is shown to be an admin of the Event's club, as `PATCH events/:id`
 * requires. The gate of the QR link and the zip, which stay the club's (ruling 492).
 */
export async function organisersEvent(
  supabase: SupabaseService,
  orgs: OrganizationsService,
  eventId: string,
  userId: string,
): Promise<GatedPhotoEvent> {
  const event = await photoEvent(supabase, eventId);
  await orgs.assertOrgRole(event.organization_id, userId, 'admin');
  return { ...event, auditActor: null };
}

/**
 * The moderation gate (ruling 491): an admin of the Event's club, or else a platform super admin,
 * whose writes are then recorded. The club is asked first, so a club admin's request reads nothing
 * more. Only a club refusal (not a member, role too low: a 403) leads to the platform role, read so
 * that a failed read is a 5xx, never a pass and never a silent refusal (ruling 461). A caller who is
 * not a super admin gets the club's refusal back.
 */
export async function moderatorsEvent(
  supabase: SupabaseService,
  orgs: OrganizationsService,
  eventId: string,
  userId: string,
): Promise<GatedPhotoEvent> {
  const event = await photoEvent(supabase, eventId);
  try {
    await orgs.assertOrgRole(event.organization_id, userId, 'admin');
    return { ...event, auditActor: null };
  } catch (refusal) {
    if (!(refusal instanceof ForbiddenException)) throw refusal;
    if ((await readPlatformRole(supabase, userId)) !== 'super_admin') throw refusal;
    return { ...event, auditActor: userId };
  }
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
