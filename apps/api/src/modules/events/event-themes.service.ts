import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import type { UpsertEventThemeDto } from './dto/events.dto';

const THEME_LOGO_BUCKET = 'event-assets';
const THEME_LOGO_MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_LOGO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

interface EventRow {
  id: string;
  organization_id: string;
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
  ) {}

  async getTheme(eventId: string) {
    await this.getEvent(eventId);
    const { data, error } = await this.supabase.service
      .from('themes')
      .select('*')
      .eq('event_id', eventId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    return this.toThemeResponse(data);
  }

  async upsertTheme(eventId: string, dto: UpsertEventThemeDto, userId: string) {
    const event = await this.getEvent(eventId);
    await this.organizations.assertOrgRole(event.organization_id, userId, 'admin');

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
    return this.toThemeResponse(data);
  }

  async uploadLogo(
    eventId: string,
    file: ThemeLogoUpload,
    userId: string,
  ): Promise<{ url: string }> {
    const event = await this.getEvent(eventId);
    await this.organizations.assertOrgRole(event.organization_id, userId, 'admin');

    if (!file.buffer.length) throw new BadRequestException('No logo file uploaded.');
    if (file.buffer.length > THEME_LOGO_MAX_BYTES) {
      throw new BadRequestException('Logo upload exceeds the 10 MB size limit.');
    }
    if (!ALLOWED_LOGO_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Logo upload must be a PNG, JPEG, or WebP image.');
    }

    await this.ensureBucket();
    const extension = this.extensionFor(file.mimetype);
    const safeBase = file.filename
      .toLowerCase()
      .replace(/\.[^.]+$/u, '')
      .replace(/[^a-z0-9-]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 60);
    const path = `events/${eventId}/theme/logo-${Date.now()}-${safeBase || 'image'}.${extension}`;

    const { error } = await this.supabase.service.storage
      .from(THEME_LOGO_BUCKET)
      .upload(path, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });
    if (error) throw new BadRequestException(error.message);

    const { data } = this.supabase.service.storage.from(THEME_LOGO_BUCKET).getPublicUrl(path);
    return { url: data.publicUrl };
  }

  private async getEvent(eventId: string): Promise<EventRow> {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('id, organization_id')
      .eq('id', eventId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Event ${eventId} not found`);
    return data as EventRow;
  }

  private async ensureBucket(): Promise<void> {
    const storage = this.supabase.service.storage;
    const { data, error } = await storage.getBucket(THEME_LOGO_BUCKET);
    if (data && !error) return;

    const created = await storage.createBucket(THEME_LOGO_BUCKET, {
      public: true,
      fileSizeLimit: THEME_LOGO_MAX_BYTES,
      allowedMimeTypes: Array.from(ALLOWED_LOGO_MIME_TYPES),
    });
    if (created.error && !/already exists/iu.test(created.error.message)) {
      throw new BadRequestException(created.error.message);
    }
  }

  private extensionFor(mimetype: string): 'png' | 'jpg' | 'webp' {
    if (mimetype === 'image/png') return 'png';
    if (mimetype === 'image/webp') return 'webp';
    return 'jpg';
  }

  private toThemeRow(eventId: string, dto: UpsertEventThemeDto): Record<string, unknown> {
    return {
      event_id: eventId,
      primary_color: dto.primaryColor ?? '#c0392b',
      secondary_color: dto.secondaryColor ?? '#2c3e50',
      accent_color: dto.accentColor ?? '#f59e0b',
      logo_url: dto.logoUrl ?? null,
      hero_image_url: dto.heroImageUrl ?? null,
      font_display: dto.fontDisplay ?? 'Cinzel',
      font_body: dto.fontBody ?? 'Inter',
      custom_css: dto.customCss ?? null,
    };
  }

  private toThemeResponse(row: unknown) {
    if (!row || typeof row !== 'object') return null;
    const data = row as Record<string, unknown>;
    return {
      id: data['id'],
      eventId: data['event_id'],
      primaryColor: data['primary_color'],
      secondaryColor: data['secondary_color'],
      accentColor: data['accent_color'],
      logoUrl: data['logo_url'],
      heroImageUrl: data['hero_image_url'],
      fontDisplay: data['font_display'],
      fontBody: data['font_body'],
      customCss: data['custom_css'],
    };
  }
}
