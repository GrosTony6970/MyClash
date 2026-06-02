import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import type { UpsertEventThemeDto } from './dto/events.dto';
import { EventsService } from './events.service';

interface EventRow {
  id: string;
  organization_id: string;
  logo_url: string | null;
}

export interface ThemeLogoUpload {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

@Injectable()
export class EventThemesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly organizations: OrganizationsService,
    // Logo writes delegate here so events.logo_url stays the
    // canonical column. EventsService doesn't depend on this
    // service back, so no forwardRef needed.
    private readonly events: EventsService,
  ) {}

  async getTheme(eventId: string) {
    // events.logo_url is the canonical column; merge it into the
    // theme response so existing clients keep seeing `logoUrl` at
    // the top level even after 0084 dropped themes.logo_url.
    const event = await this.getEvent(eventId);
    const { data, error } = await this.supabase.service
      .from('themes')
      .select('*')
      .eq('event_id', eventId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    return this.toThemeResponse(data, event.logo_url);
  }

  async upsertTheme(eventId: string, dto: UpsertEventThemeDto, userId: string) {
    const event = await this.getEvent(eventId);
    await this.organizations.assertOrgRole(event.organization_id, userId, 'admin');

    // logoUrl now lives on events.logo_url, not themes.logo_url
    // (migration 0084). If the dto carries one, mirror it to the
    // events row; theme upsert below skips it entirely.
    let eventLogoUrl = event.logo_url;
    if (dto.logoUrl !== undefined) {
      eventLogoUrl = dto.logoUrl ?? null;
      const { error: logoErr } = await this.supabase.service
        .from('events')
        .update({ logo_url: eventLogoUrl, updated_at: new Date().toISOString() })
        .eq('id', eventId);
      if (logoErr) throw new BadRequestException(logoErr.message);
    }

    const values = this.toThemeRow(eventId, dto);
    const { data: existing, error: existingError } = await this.supabase.service
      .from('themes')
      .select('id')
      .eq('event_id', eventId)
      .maybeSingle();

    if (existingError) throw new BadRequestException(existingError.message);

    const query = existing
      ? this.supabase.service
          .from('themes')
          .update(values)
          .eq('id', (existing as { id: string }).id)
      : this.supabase.service.from('themes').insert(values);

    const { data, error } = await query.select('*').single();
    if (error) throw new BadRequestException(error.message);
    return this.toThemeResponse(data, eventLogoUrl);
  }

  /**
   * @deprecated Thin shim — delegates to the canonical
   * `EventsService.uploadLogo` so the storage path AND the
   * `events.logo_url` column are written together. Prefer
   * `POST /api/v1/events/:eventId/logo` directly.
   */
  async uploadLogo(
    eventId: string,
    file: ThemeLogoUpload,
    userId: string,
  ): Promise<{ url: string }> {
    return this.events.uploadLogo(eventId, userId, file);
  }

  private async getEvent(eventId: string): Promise<EventRow> {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('id, organization_id, logo_url')
      .eq('id', eventId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Event ${eventId} not found`);
    return data as EventRow;
  }

  private toThemeRow(eventId: string, dto: UpsertEventThemeDto): Record<string, unknown> {
    // logo_url intentionally omitted — migration 0084 dropped it
    // from this table; the canonical column is events.logo_url.
    // Color overrides + font pickers + custom_css retired in 0086 —
    // unified MyClash design from @myclash/design-tokens applies.
    return {
      event_id: eventId,
      hero_image_url: dto.heroImageUrl ?? null,
    };
  }

  /**
   * Merge the (now-thin) theme row with the event's canonical logo
   * URL. Theme response surfaces `logoUrl` at the top level so
   * callers don't need to fan out a second fetch.
   */
  private toThemeResponse(row: unknown, eventLogoUrl: string | null) {
    if (!row || typeof row !== 'object') {
      if (eventLogoUrl) return { logoUrl: eventLogoUrl };
      return null;
    }
    const data = row as Record<string, unknown>;
    return {
      id: data['id'],
      eventId: data['event_id'],
      logoUrl: eventLogoUrl,
      heroImageUrl: data['hero_image_url'],
    };
  }
}
