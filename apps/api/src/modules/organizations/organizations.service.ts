import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type {
  AddMemberDto,
  CreateOrganizationDto,
  UpdateOrganizationDto,
} from './dto/organizations.dto';

const ORG_LOGO_BUCKET = 'event-assets';
const ORG_LOGO_MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_ORG_LOGO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface OrgLogoUpload {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

@Injectable()
export class OrganizationsService {
  constructor(private readonly supabase: SupabaseService) {}

  // ── List (super admin) ───────────────────────────────────────────────────────

  async list() {
    const { data, error } = await this.supabase.service
      .from('organizations')
      .select('*, organization_members(user_id, role)')
      .order('created_at', { ascending: false });

    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // ── Get one ──────────────────────────────────────────────────────────────────

  async getById(id: string) {
    const { data, error } = await this.supabase.service
      .from('organizations')
      .select('*, organization_members(user_id, role, created_at)')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Organization ${id} not found`);
    return data;
  }

  async getBySlug(slug: string) {
    const { data, error } = await this.supabase.service
      .from('organizations')
      .select('id, name, slug, status')
      .eq('slug', slug)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Organization "${slug}" not found`);
    return data;
  }

  // ── Create ───────────────────────────────────────────────────────────────────
  // Creates with status='pending_approval' per T-105 AC.
  // (T-009b creates with status='active' for self-service signup — different path)

  async dashboardStats(orgId: string, userId: string) {
    await this.assertOrgRole(orgId, userId, 'scorekeeper');

    const { data: events, error: eventsError } = await this.supabase.service
      .from('events')
      .select('id, start_date')
      .eq('organization_id', orgId);
    if (eventsError) throw new BadRequestException(eventsError.message);

    const eventRows = (events ?? []) as Array<{ id: string; start_date?: string | null }>;
    const eventIds = eventRows.map((event) => event.id);
    const today = new Date().toISOString().slice(0, 10);
    const upcomingEvents = eventRows.filter((event) => (event.start_date ?? '') >= today).length;

    let tournamentsTotal = 0;
    let fighterParticipations = 0;
    let refereeParticipations = 0;

    if (eventIds.length > 0) {
      const { data: tournaments, error: tournamentsError } = await this.supabase.service
        .from('tournaments')
        .select('id')
        .in('event_id', eventIds);
      if (tournamentsError) throw new BadRequestException(tournamentsError.message);

      const tournamentIds = ((tournaments ?? []) as Array<{ id: string }>).map(
        (tournament) => tournament.id,
      );
      tournamentsTotal = tournamentIds.length;

      if (tournamentIds.length > 0) {
        const { data: registrations, error: registrationsError } = await this.supabase.service
          .from('registrations')
          .select('id')
          .in('tournament_id', tournamentIds);
        if (registrationsError) throw new BadRequestException(registrationsError.message);
        fighterParticipations = (registrations ?? []).length;
      }

      const { data: referees, error: refereesError } = await this.supabase.service
        .from('referee_qualifications')
        .select('id')
        .eq('active', true)
        .in('event_id', eventIds);
      if (refereesError) throw new BadRequestException(refereesError.message);
      refereeParticipations = (referees ?? []).length;
    }

    return {
      eventsTotal: eventRows.length,
      upcomingEvents,
      tournamentsTotal,
      fighterParticipations,
      refereeParticipations,
    };
  }

  async create(dto: CreateOrganizationDto, createdByUserId: string) {
    // Check slug uniqueness
    const { data: existing } = await this.supabase.service
      .from('organizations')
      .select('id')
      .eq('slug', dto.slug)
      .maybeSingle();

    if (existing) throw new ConflictException(`Slug "${dto.slug}" is already taken`);

    const { data, error } = await this.supabase.service
      .from('organizations')
      .insert({
        name: dto.name.trim(),
        slug: dto.slug,
        contact_email: dto.contactEmail ?? null,
        status: 'pending_approval',
        created_by_user_id: createdByUserId,
      })
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);

    // Auto-add creator as owner
    await this.supabase.service.from('organization_members').insert({
      organization_id: (data as { id: string }).id,
      user_id: createdByUserId,
      role: 'owner',
    });

    return data;
  }

  // ── Update ───────────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateOrganizationDto, userId: string) {
    await this.assertOrgRole(id, userId, 'owner');

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.name !== undefined) updates['name'] = dto.name.trim();
    if (dto.contactEmail !== undefined) updates['contact_email'] = dto.contactEmail;
    if (dto.logoUrl !== undefined) updates['logo_url'] = dto.logoUrl;

    const { data, error } = await this.supabase.service
      .from('organizations')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async uploadLogo(id: string, userId: string, file: OrgLogoUpload): Promise<{ url: string }> {
    await this.assertOrgRole(id, userId, 'admin');

    if (!file.buffer.length) throw new BadRequestException('No logo file uploaded.');
    if (file.buffer.length > ORG_LOGO_MAX_BYTES) {
      throw new BadRequestException('Logo upload exceeds the 10 MB size limit.');
    }
    if (!ALLOWED_ORG_LOGO_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Logo upload must be a PNG, JPEG, or WebP image.');
    }

    await this.ensureLogoBucket();
    const extension =
      file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const safeBase = file.filename
      .toLowerCase()
      .replace(/\.[^.]+$/u, '')
      .replace(/[^a-z0-9-]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 60);
    const path = `organizations/${id}/logo-${Date.now()}-${safeBase || 'image'}.${extension}`;

    const { error } = await this.supabase.service.storage
      .from(ORG_LOGO_BUCKET)
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: true });
    if (error) throw new BadRequestException(error.message);

    const { data } = this.supabase.service.storage.from(ORG_LOGO_BUCKET).getPublicUrl(path);
    const url = data.publicUrl;

    const { error: updateError } = await this.supabase.service
      .from('organizations')
      .update({ logo_url: url, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (updateError) throw new BadRequestException(updateError.message);

    return { url };
  }

  private async ensureLogoBucket(): Promise<void> {
    const storage = this.supabase.service.storage;
    const { data, error } = await storage.getBucket(ORG_LOGO_BUCKET);
    if (data && !error) return;
    const created = await storage.createBucket(ORG_LOGO_BUCKET, {
      public: true,
      fileSizeLimit: ORG_LOGO_MAX_BYTES,
      allowedMimeTypes: Array.from(ALLOWED_ORG_LOGO_MIME_TYPES),
    });
    if (created.error && !/already exists/iu.test(created.error.message)) {
      throw new BadRequestException(created.error.message);
    }
  }

  // ── Approve (super admin) ────────────────────────────────────────────────────

  async approve(id: string) {
    const { data, error } = await this.supabase.service
      .from('organizations')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Organization ${id} not found`);
    return data;
  }

  // ── Add member ───────────────────────────────────────────────────────────────

  async addMember(orgId: string, dto: AddMemberDto, requestingUserId: string) {
    await this.assertOrgRole(orgId, requestingUserId, 'owner');
    // Super-admins are platform-scoped; they must not appear in any org's
    // member list. Mirror check in AdminUsersService.addOrgMembership.
    await this.assertNotSuperAdmin(dto.userId);

    const { data, error } = await this.supabase.service
      .from('organization_members')
      .upsert({
        organization_id: orgId,
        user_id: dto.userId,
        role: dto.role,
      })
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /** Throws if `userId` holds the platform-level super-admin role. */
  private async assertNotSuperAdmin(userId: string) {
    const { data } = await this.supabase.service
      .from('platform_roles')
      .select('user_id')
      .eq('user_id', userId)
      .eq('role', 'super_admin')
      .maybeSingle();
    if (data) {
      throw new ForbiddenException(
        'Cannot add a super-admin to an organization. Revoke super-admin status first.',
      );
    }
  }

  // ── Helper: assert org role ──────────────────────────────────────────────────

  async assertOrgRole(
    orgId: string,
    userId: string,
    minRole:
      | 'owner'
      | 'admin'
      | 'editor'
      | 'scorekeeper'
      | 'referee'
      | 'workshop_lead'
      | 'read_only',
  ) {
    const { data } = await this.supabase.service
      .from('organization_members')
      .select('role')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!data) throw new ForbiddenException('You are not a member of this organization');

    const roleHierarchy = [
      'read_only',
      'scorekeeper',
      'referee',
      'workshop_lead',
      'editor',
      'admin',
      'owner',
    ];
    const memberRole = (data as { role: string }).role;
    if (roleHierarchy.indexOf(memberRole) < roleHierarchy.indexOf(minRole)) {
      throw new ForbiddenException(`Requires ${minRole} role or higher`);
    }
  }
}
