import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PhotoLink } from '@myclash/types';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import { organisersEvent } from './photo-organiser';
import { photoToken } from './photo-token';

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
    const event = await organisersEvent(this.supabase, this.orgs, eventId, userId);
    return this.linkOf(event.id, event.photo_token_version);
  }

  async rotate(eventId: string, userId: string): Promise<PhotoLink> {
    const event = await organisersEvent(this.supabase, this.orgs, eventId, userId);
    const version = event.photo_token_version + 1;
    const { error } = await this.supabase.service
      .from('events')
      .update({ photo_token_version: version })
      .eq('id', event.id);
    if (error) throw new Error(error.message);
    return this.linkOf(event.id, version);
  }

  private linkOf(eventId: string, version: number): PhotoLink {
    return { token: photoToken(this.secret, eventId, version), version };
  }
}
