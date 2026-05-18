import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type { ClubQueryDto, CreateClubDto, UpdateClubDto } from './dto/clubs.dto';

export type DeleteClubMode = 'safe' | 'archive' | 'cleanup';

const CLUB_LOGO_BUCKET = 'event-assets';
const CLUB_LOGO_MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_CLUB_LOGO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

type ClubDeleteBlockers = {
  globalPersons: number;
  eventPersons: number;
  fighterClubLinks: number;
};

export interface ClubLogoUpload {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

type ClubReviewStatus = 'pending' | 'approved' | 'linked' | 'rejected' | 'all';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

@Injectable()
export class ClubsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(query: ClubQueryDto) {
    let q = this.supabase.service.from('clubs').select('*').order('name', { ascending: true });

    if (!this.booleanQueryValue(query.includeArchived)) {
      q = q.is('archived_at', null) as typeof q;
    }

    if (query.q) {
      q = query.searchAbv
        ? (q.or(`name.ilike.%${query.q}%,abbreviation.ilike.%${query.q}%`) as typeof q)
        : (q.ilike('name', `%${query.q}%`) as typeof q);
    }
    if (query.country) q = q.eq('country_code', query.country.toUpperCase()) as typeof q;

    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async getBySlug(slug: string) {
    const { data, error } = await this.supabase.service
      .from('clubs')
      .select('*')
      .eq('slug', slug)
      .is('archived_at', null)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Club "${slug}" not found`);
    return data;
  }

  async create(dto: CreateClubDto) {
    return this.createClubRow(dto, false);
  }

  async createUnverified(dto: CreateClubDto) {
    return this.createClubRow(dto, true);
  }

  private async createClubRow(dto: CreateClubDto, unverified: boolean) {
    const baseSlug = slugify(dto.name);
    const slug = `${baseSlug}-${Date.now().toString(36)}`;

    const { data, error } = await this.supabase.service
      .from('clubs')
      .insert({
        name: dto.name.trim(),
        slug,
        abbreviation: dto.abbreviation?.trim().toUpperCase() ?? null,
        city: dto.city ?? null,
        country_code: dto.countryCode?.toUpperCase() ?? null,
        website: dto.website ?? null,
        logo_url: dto.logoUrl ?? null,
        unverified: unverified ? 'true' : 'false',
      })
      .select('*')
      .single();

    if (error) {
      if (error.message.includes('unique')) throw new ConflictException('Club slug already exists');
      throw new BadRequestException(error.message);
    }
    return data;
  }

  async listReviewRequests(status: ClubReviewStatus = 'pending') {
    let query = this.supabase.service
      .from('club_review_requests')
      .select(
        `
        *,
        proposed_club:clubs!club_review_requests_proposed_club_id_fkey(*),
        linked_existing_club:clubs!club_review_requests_linked_existing_club_id_fkey(*),
        event:events(id, name, slug),
        organization:organizations(id, name, slug)
      `,
      )
      .order('created_at', { ascending: false });

    if (status !== 'all') query = query.eq('status', status) as typeof query;

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async approveReviewRequest(id: string) {
    const request = await this.getReviewRequest(id);
    const proposedClubId = request.proposed_club_id;

    const verify = await this.supabase.service
      .from('clubs')
      .update({ unverified: 'false', archived_at: null })
      .eq('id', proposedClubId);
    if (verify.error) throw new BadRequestException(verify.error.message);

    return this.updateReviewRequest(id, {
      status: 'approved',
      review_notes: null,
      updated_at: new Date().toISOString(),
    });
  }

  async linkReviewRequest(id: string, existingClubId: string, notes?: string) {
    const request = await this.getReviewRequest(id);
    await this.getClubById(existingClubId);
    const proposedClubId = request.proposed_club_id;

    const operations = [
      this.supabase.service
        .from('global_persons')
        .update({ club_id: existingClubId })
        .eq('club_id', proposedClubId),
      this.supabase.service
        .from('persons')
        .update({ club_id: existingClubId })
        .eq('club_id', proposedClubId),
      this.supabase.service
        .from('fighter_clubs')
        .update({ club_id: existingClubId })
        .eq('club_id', proposedClubId),
      this.supabase.service
        .from('clubs')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', proposedClubId),
    ];
    const results = await Promise.all(operations);
    const failed = results.find((result) => result.error);
    if (failed?.error) throw new BadRequestException(failed.error.message);

    return this.updateReviewRequest(id, {
      status: 'linked',
      linked_existing_club_id: existingClubId,
      review_notes: notes ?? null,
      updated_at: new Date().toISOString(),
    });
  }

  async rejectReviewRequest(id: string, notes?: string) {
    const request = await this.getReviewRequest(id);
    const archive = await this.supabase.service
      .from('clubs')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', request.proposed_club_id);
    if (archive.error) throw new BadRequestException(archive.error.message);

    return this.updateReviewRequest(id, {
      status: 'rejected',
      review_notes: notes ?? null,
      updated_at: new Date().toISOString(),
    });
  }

  async update(id: string, dto: UpdateClubDto) {
    const updates: Record<string, unknown> = {};
    if (dto.name !== undefined) updates['name'] = dto.name.trim();
    if (dto.abbreviation !== undefined)
      updates['abbreviation'] = dto.abbreviation?.trim().toUpperCase() ?? null;
    if (dto.city !== undefined) updates['city'] = dto.city;
    if (dto.countryCode !== undefined) updates['country_code'] = dto.countryCode.toUpperCase();
    if (dto.website !== undefined) updates['website'] = dto.website;
    if (dto.logoUrl !== undefined) updates['logo_url'] = dto.logoUrl;

    const { data, error } = await this.supabase.service
      .from('clubs')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Club ${id} not found`);
    return data;
  }

  async uploadLogo(id: string, file: ClubLogoUpload): Promise<{ url: string }> {
    await this.getClubById(id);

    if (!file.buffer.length) throw new BadRequestException('No logo file uploaded.');
    if (file.buffer.length > CLUB_LOGO_MAX_BYTES) {
      throw new BadRequestException('Logo upload exceeds the 10 MB size limit.');
    }
    if (!ALLOWED_CLUB_LOGO_MIME_TYPES.has(file.mimetype)) {
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
    const path = `clubs/${id}/logo-${Date.now()}-${safeBase || 'image'}.${extension}`;

    const { error } = await this.supabase.service.storage
      .from(CLUB_LOGO_BUCKET)
      .upload(path, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });
    if (error) throw new BadRequestException(error.message);

    const { data } = this.supabase.service.storage.from(CLUB_LOGO_BUCKET).getPublicUrl(path);
    await this.update(id, { logoUrl: data.publicUrl });
    return { url: data.publicUrl };
  }

  async deleteClub(id: string, mode: DeleteClubMode = 'safe') {
    if (!['safe', 'archive', 'cleanup'].includes(mode)) {
      throw new BadRequestException('Unknown club deletion mode');
    }

    if (mode === 'archive') {
      const { error } = await this.supabase.service
        .from('clubs')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single();

      if (error) throw new BadRequestException(error.message);
      return { deleted: false, mode, cleanupApplied: false, archived: true };
    }

    if (mode === 'safe') {
      const blockers = await this.collectClubDeleteBlockers(id);
      if (Object.values(blockers).some((count) => count > 0)) {
        throw new BadRequestException({
          message: 'Club is still referenced and cannot be safely deleted',
          blockers,
        });
      }

      await this.deleteClubRow(id);
      return { deleted: true, mode, cleanupApplied: false, archived: false };
    }

    await this.clearSupportedClubReferences(id);
    await this.deleteClubRow(id);
    return { deleted: true, mode, cleanupApplied: true, archived: false };
  }

  private booleanQueryValue(value: unknown): boolean {
    return value === true || value === 'true';
  }

  private async getClubById(id: string) {
    const { data, error } = await this.supabase.service
      .from('clubs')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Club ${id} not found`);
    return data;
  }

  private async getReviewRequest(id: string) {
    const { data, error } = await this.supabase.service
      .from('club_review_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Club review request ${id} not found`);
    return data as {
      id: string;
      proposed_club_id: string;
      status: string;
    };
  }

  private async updateReviewRequest(id: string, updates: Record<string, unknown>) {
    const { data, error } = await this.supabase.service
      .from('club_review_requests')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  private async ensureBucket(): Promise<void> {
    const storage = this.supabase.service.storage;
    const { data, error } = await storage.getBucket(CLUB_LOGO_BUCKET);
    if (data && !error) return;

    const created = await storage.createBucket(CLUB_LOGO_BUCKET, {
      public: true,
      fileSizeLimit: CLUB_LOGO_MAX_BYTES,
      allowedMimeTypes: Array.from(ALLOWED_CLUB_LOGO_MIME_TYPES),
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

  private async collectClubDeleteBlockers(id: string): Promise<ClubDeleteBlockers> {
    const [globalPersons, eventPersons, fighterClubLinks] = await Promise.all([
      this.countReferences('global_persons', 'club_id', id),
      this.countReferences('persons', 'club_id', id),
      this.countReferences('fighter_clubs', 'club_id', id),
    ]);

    return { globalPersons, eventPersons, fighterClubLinks };
  }

  private async countReferences(table: string, column: string, value: string): Promise<number> {
    const { count, error } = await this.supabase.service
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq(column, value);

    if (error) throw new BadRequestException(error.message);
    return count ?? 0;
  }

  private async clearSupportedClubReferences(id: string) {
    const operations = [
      this.supabase.service.from('global_persons').update({ club_id: null }).eq('club_id', id),
      this.supabase.service.from('persons').update({ club_id: null }).eq('club_id', id),
      this.supabase.service.from('fighter_clubs').delete().eq('club_id', id),
    ];

    const results = await Promise.all(operations);
    const failed = results.find((result) => result.error);
    if (failed?.error) throw new BadRequestException(failed.error.message);
  }

  private async deleteClubRow(id: string) {
    const { error } = await this.supabase.service.from('clubs').delete().eq('id', id);
    if (error) throw new BadRequestException(error.message);
  }
}
