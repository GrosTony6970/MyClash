import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import { photoToken } from './photo-token';

export interface PhotoLink {
  token: string;
  version: number;
}

/**
 * The Event's photo QR link, for its organisers only (org admin, as `PATCH events/:id`). The token
 * is derived, never stored (`photo-token.ts`), so reading it costs one row and rotating it is one
 * version bump.
 *
 * Two organisers rotating at once both write version + 1 from the same read: one bump, the same
 * new link for both. Accepted: neither keeps a link the other retired.
 */
@Injectable()
export class PhotoLinkService {
  private readonly secret: string;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
    config: ConfigService,
  ) {
    this.secret = config.getOrThrow<string>('PHOTO_TOKEN_SECRET');
  }

  async read(eventId: string, userId: string): Promise<PhotoLink> {
    const event = await this.organisersEvent(eventId, userId);
    return this.linkOf(event.id, event.photo_token_version);
  }

  async rotate(eventId: string, userId: string): Promise<PhotoLink> {
    const event = await this.organisersEvent(eventId, userId);
    const version = event.photo_token_version + 1;
    const { error } = await this.supabase.service
      .from('events')
      .update({ photo_token_version: version })
      .eq('id', event.id);
    if (error) throw new Error(error.message);
    return this.linkOf(event.id, version);
  }

  private async organisersEvent(
    eventId: string,
    userId: string,
  ): Promise<{ id: string; photo_token_version: number }> {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('id, organization_id, photo_token_version')
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Event not found');
    const event = data as { id: string; organization_id: string; photo_token_version: number };
    await this.orgs.assertOrgRole(event.organization_id, userId, 'admin');
    return event;
  }

  private linkOf(eventId: string, version: number): PhotoLink {
    return { token: photoToken(this.secret, eventId, version), version };
  }
}
