import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type {
  CreateFighterDto,
  FighterQueryDto,
  MergeFightersDto,
  PromoteFighterDto,
  UpdateFighterDto,
} from './dto/fighters.dto';

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
export class FightersService {
  constructor(private readonly supabase: SupabaseService) {}

  // ── List ────────────────────────────────────────────────────────────────────

  async list(query: FighterQueryDto) {
    let q = this.supabase.service
      .from('fighters')
      .select('*, clubs(name, slug)')
      .order('family_name', { ascending: true })
      .order('given_name', { ascending: true });

    if (query.q) {
      q = q.or(
        `given_name.ilike.%${query.q}%,family_name.ilike.%${query.q}%,display_name.ilike.%${query.q}%`,
      ) as typeof q;
    }
    if (query.club) {
      q = q.eq('clubs.slug', query.club) as typeof q;
    }

    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // ── Get by slug ──────────────────────────────────────────────────────────────

  async getBySlug(slug: string) {
    const { data, error } = await this.supabase.service
      .from('fighters')
      .select('*, clubs(name, slug, city, country_code)')
      .eq('slug', slug)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Fighter "${slug}" not found`);
    return data;
  }

  // ── Create ───────────────────────────────────────────────────────────────────

  async create(dto: CreateFighterDto) {
    const baseSlug = slugify(dto.displayName || `${dto.givenName}-${dto.familyName}`);
    const slug = `${baseSlug}-${Date.now().toString(36)}`;

    const { data, error } = await this.supabase.service
      .from('fighters')
      .insert({
        slug,
        display_name: dto.displayName.trim(),
        given_name: dto.givenName.trim(),
        family_name: dto.familyName.trim(),
        club_id: dto.clubId ?? null,
        country_code: dto.countryCode?.toUpperCase() ?? null,
        hema_ratings_id: dto.hemaRatingsId ?? null,
        photo_url: dto.photoUrl ?? null,
        bio: dto.bio ?? null,
        date_of_birth: dto.dateOfBirth ?? null,
        gender_category: dto.genderCategory ?? null,
      })
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Update ───────────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateFighterDto) {
    const updates: Record<string, unknown> = {};
    if (dto.givenName !== undefined) updates['given_name'] = dto.givenName.trim();
    if (dto.familyName !== undefined) updates['family_name'] = dto.familyName.trim();
    if (dto.displayName !== undefined) updates['display_name'] = dto.displayName.trim();
    if (dto.clubId !== undefined) updates['club_id'] = dto.clubId;
    if (dto.countryCode !== undefined) updates['country_code'] = dto.countryCode.toUpperCase();
    if (dto.hemaRatingsId !== undefined) updates['hema_ratings_id'] = dto.hemaRatingsId;
    if (dto.photoUrl !== undefined) updates['photo_url'] = dto.photoUrl;
    if (dto.bio !== undefined) updates['bio'] = dto.bio;
    updates['updated_at'] = new Date().toISOString();

    const { data, error } = await this.supabase.service
      .from('fighters')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Fighter ${id} not found`);
    return data;
  }

  // ── Promote Person → Fighter ─────────────────────────────────────────────────

  async promote(dto: PromoteFighterDto, claimedUserId: string) {
    // Verify the claimed user owns this Person
    const { data: person, error: personError } = await this.supabase.service
      .from('persons')
      .select('id, given_name, family_name, email, club_id, claimed_by_user_id, global_fighter_id')
      .eq('id', dto.personId)
      .maybeSingle();

    if (personError || !person) {
      throw new NotFoundException(`Person ${dto.personId} not found`);
    }

    const p = person as {
      id: string;
      given_name: string;
      family_name: string;
      email: string;
      club_id: string | null;
      claimed_by_user_id: string | null;
      global_fighter_id: string | null;
    };

    if (p.claimed_by_user_id !== claimedUserId) {
      throw new ForbiddenException('You can only promote your own Person profile to a Fighter');
    }

    if (p.global_fighter_id) {
      // Already promoted — return existing fighter
      const { data: existing } = await this.supabase.service
        .from('fighters')
        .select('*')
        .eq('id', p.global_fighter_id)
        .maybeSingle();
      return existing;
    }

    // Create the global Fighter
    const displayName = `${p.given_name} ${p.family_name}`;
    const baseSlug = slugify(displayName);
    const slug = `${baseSlug}-${Date.now().toString(36)}`;

    const { data: fighter, error: fighterError } = await this.supabase.service
      .from('fighters')
      .insert({
        slug,
        display_name: displayName,
        given_name: p.given_name,
        family_name: p.family_name,
        club_id: p.club_id,
        claimed_by_user_id: claimedUserId,
      })
      .select('*')
      .single();

    if (fighterError || !fighter) {
      throw new BadRequestException(`Failed to create Fighter: ${fighterError?.message}`);
    }

    const f = fighter as { id: string };

    // Link Person → Fighter
    await this.supabase.service
      .from('persons')
      .update({ global_fighter_id: f.id })
      .eq('id', dto.personId);

    return fighter;
  }

  // ── Merge (super admin) ──────────────────────────────────────────────────────

  async merge(dto: MergeFightersDto) {
    // Re-point all persons from source → target
    await this.supabase.service
      .from('persons')
      .update({ global_fighter_id: dto.targetId })
      .eq('global_fighter_id', dto.sourceId);

    // Re-point all registrations from source → target
    await this.supabase.service
      .from('registrations')
      .update({ fighter_id: dto.targetId })
      .eq('fighter_id', dto.sourceId);

    // Delete source fighter
    await this.supabase.service.from('fighters').delete().eq('id', dto.sourceId);

    return { merged: true, targetId: dto.targetId };
  }
}
