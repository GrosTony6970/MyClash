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

    const { data, error } = await this.supabase.service
      .from('organizations')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
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

  // ── Helper: assert org role ──────────────────────────────────────────────────

  async assertOrgRole(
    orgId: string,
    userId: string,
    minRole: 'owner' | 'admin' | 'editor' | 'scorekeeper',
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
