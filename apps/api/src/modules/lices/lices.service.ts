import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type { CreateLiceDto, UpdateLiceDto } from './dto/lices.dto';

@Injectable()
export class LicesService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(eventId: string) {
    const { data, error } = await this.supabase.service
      .from('lices')
      .select('*')
      .eq('event_id', eventId)
      .order('sort_order', { ascending: true });

    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async create(eventId: string, dto: CreateLiceDto) {
    const { data, error } = await this.supabase.service
      .from('lices')
      .insert({
        event_id: eventId,
        name: dto.name.trim(),
        location_label: dto.locationLabel ?? null,
        color_hex: dto.colorHex ?? null,
        sort_order: dto.sortOrder ?? 0,
      })
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async update(liceId: string, dto: UpdateLiceDto) {
    const updates: Record<string, unknown> = {};
    if (dto.name !== undefined) updates['name'] = dto.name.trim();
    if (dto.locationLabel !== undefined) updates['location_label'] = dto.locationLabel;
    if (dto.colorHex !== undefined) updates['color_hex'] = dto.colorHex;
    if (dto.sortOrder !== undefined) updates['sort_order'] = dto.sortOrder;

    const { data, error } = await this.supabase.service
      .from('lices')
      .update(updates)
      .eq('id', liceId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Lice ${liceId} not found`);
    return data;
  }

  async delete(liceId: string) {
    const { error } = await this.supabase.service.from('lices').delete().eq('id', liceId);

    if (error) throw new BadRequestException(error.message);
  }
}
