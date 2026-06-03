import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type { CreateLiceDto, UpdateLiceDto } from './dto/lices.dto';

type Row = Record<string, unknown>;

@Injectable()
export class LicesService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(eventId: string) {
    // Project the joined venue (id + name) so the schedule grid +
    // venues page can group lice columns under a venue header
    // without a second round-trip.
    const { data, error } = await this.supabase.service
      .from('lices')
      .select('*, venues(id, name)')
      .eq('event_id', eventId)
      .order('sort_order', { ascending: true });

    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async create(eventId: string, dto: CreateLiceDto) {
    if (dto.venueId) {
      await this.assertVenueBelongsToEventsOrg(dto.venueId, eventId);
    }
    const { data, error } = await this.supabase.service
      .from('lices')
      .insert({
        event_id: eventId,
        venue_id: dto.venueId ?? null,
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
    // When the caller is repointing the lice at a different venue,
    // make sure it belongs to the same org as the lice's event.
    if (dto.venueId) {
      const { data: liceRow } = await this.supabase.service
        .from('lices')
        .select('event_id')
        .eq('id', liceId)
        .maybeSingle();
      if (!liceRow) throw new NotFoundException(`Lice ${liceId} not found`);
      await this.assertVenueBelongsToEventsOrg(dto.venueId, String((liceRow as Row)['event_id']));
    }

    const updates: Row = {};
    if (dto.name !== undefined) updates['name'] = dto.name.trim();
    if (dto.locationLabel !== undefined) updates['location_label'] = dto.locationLabel;
    if (dto.colorHex !== undefined) updates['color_hex'] = dto.colorHex;
    if (dto.sortOrder !== undefined) updates['sort_order'] = dto.sortOrder;
    if (dto.venueId !== undefined) updates['venue_id'] = dto.venueId;

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

  /**
   * Refuses if the picked venue's organization doesn't match the
   * event's organization — closes the cross-org reference loophole.
   */
  private async assertVenueBelongsToEventsOrg(venueId: string, eventId: string): Promise<void> {
    const { data: venue } = await this.supabase.service
      .from('venues')
      .select('organization_id')
      .eq('id', venueId)
      .maybeSingle();
    if (!venue) throw new BadRequestException(`Venue ${venueId} not found`);
    const { data: event } = await this.supabase.service
      .from('events')
      .select('organization_id')
      .eq('id', eventId)
      .maybeSingle();
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);
    if (String((venue as Row)['organization_id']) !== String((event as Row)['organization_id'])) {
      throw new BadRequestException('Venue belongs to a different organization than the event');
    }
  }
}
