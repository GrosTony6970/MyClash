import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type { ClubQueryDto, CreateClubDto, UpdateClubDto } from './dto/clubs.dto';

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
    let q = this.supabase.service
      .from('clubs')
      .select('*')
      .order('name', { ascending: true });

    if (query.q) q = q.ilike('name', `%${query.q}%`) as typeof q;
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
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Club "${slug}" not found`);
    return data;
  }

  async create(dto: CreateClubDto) {
    const baseSlug = slugify(dto.name);
    const slug = `${baseSlug}-${Date.now().toString(36)}`;

    const { data, error } = await this.supabase.service
      .from('clubs')
      .insert({
        name: dto.name.trim(),
        slug,
        city: dto.city ?? null,
        country_code: dto.countryCode?.toUpperCase() ?? null,
        website: dto.website ?? null,
        logo_url: dto.logoUrl ?? null,
        unverified: 'false',
      })
      .select('*')
      .single();

    if (error) {
      if (error.message.includes('unique')) throw new ConflictException('Club slug already exists');
      throw new BadRequestException(error.message);
    }
    return data;
  }

  async update(id: string, dto: UpdateClubDto) {
    const updates: Record<string, unknown> = {};
    if (dto.name !== undefined) updates['name'] = dto.name.trim();
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
}
