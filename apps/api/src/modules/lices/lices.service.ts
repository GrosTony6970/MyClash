import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type { CreateLiceDto, UpdateLiceDto } from './dto/lices.dto';

type Row = Record<string, unknown>;

@Injectable()
export class LicesService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(eventId: string) {
    // Project the joined venue (id + name) and area so the schedule grid,
    // venues page and public display picker can group lice columns under
    // a venue/area header without a second round-trip.
    const { data, error } = await this.supabase.service
      .from('lices')
      .select('*, venues(id, name), venue_areas(id, name)')
      .eq('event_id', eventId)
      .order('sort_order', { ascending: true });

    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async create(eventId: string, dto: CreateLiceDto) {
    if (dto.venueId) {
      await this.assertVenueBelongsToEventsOrg(dto.venueId, eventId);
    }
    if (dto.areaId) {
      await this.assertAreaBelongsToVenue(dto.areaId, dto.venueId ?? null);
    }
    const { data, error } = await this.supabase.service
      .from('lices')
      .insert({
        event_id: eventId,
        venue_id: dto.venueId ?? null,
        area_id: dto.areaId ?? null,
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
    const updates: Row = {};
    if (dto.name !== undefined) updates['name'] = dto.name.trim();
    if (dto.locationLabel !== undefined) updates['location_label'] = dto.locationLabel;
    if (dto.colorHex !== undefined) updates['color_hex'] = dto.colorHex;
    if (dto.sortOrder !== undefined) updates['sort_order'] = dto.sortOrder;
    if (dto.venueId !== undefined) updates['venue_id'] = dto.venueId;
    if (dto.areaId !== undefined) updates['area_id'] = dto.areaId;

    if (dto.venueId !== undefined || dto.areaId !== undefined) {
      await this.applyPlacementRules(liceId, dto, updates);
    }

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

  /**
   * Validates a venue/area move and mutates `updates` with the fallout.
   *
   * The area is only meaningful relative to a venue, and a PATCH can move
   * either one — or only one. So the venue an incoming area is checked
   * against is the EFFECTIVE venue: the one in this payload if it names
   * one, otherwise the one the lice already has. Checking `dto.venueId`
   * alone would wave through an area from a foreign hall on any
   * area-only PATCH.
   */
  private async applyPlacementRules(
    liceId: string,
    dto: UpdateLiceDto,
    updates: Row,
  ): Promise<void> {
    const { data: liceRow } = await this.supabase.service
      .from('lices')
      .select('event_id, venue_id')
      .eq('id', liceId)
      .maybeSingle();
    if (!liceRow) throw new NotFoundException(`Lice ${liceId} not found`);

    if (dto.venueId) {
      await this.assertVenueBelongsToEventsOrg(dto.venueId, String((liceRow as Row)['event_id']));
    }

    const effectiveVenueId =
      dto.venueId !== undefined
        ? (dto.venueId ?? null)
        : ((liceRow as Row)['venue_id'] as string | null);

    if (dto.areaId) {
      await this.assertAreaBelongsToVenue(dto.areaId, effectiveVenueId);
    }

    // Detaching the venue strands the area in a hall the lice no longer
    // stands in, so it goes with it — even when the caller said nothing
    // about the area.
    if (effectiveVenueId === null) updates['area_id'] = null;
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

  /**
   * Refuses an area that does not sit inside the venue the lice is being
   * placed in — including the case where there is no venue at all. An
   * area without a venue is a piste that claims to be in a room of a
   * building it is not in, and the display picker would group it under a
   * hall nobody set.
   */
  private async assertAreaBelongsToVenue(areaId: string, venueId: string | null): Promise<void> {
    if (!venueId) {
      throw new BadRequestException('An area can only be set on a lice that has a venue');
    }
    const { data: area } = await this.supabase.service
      .from('venue_areas')
      .select('venue_id')
      .eq('id', areaId)
      .maybeSingle();
    if (!area) throw new BadRequestException(`Area ${areaId} not found`);
    if (String((area as Row)['venue_id']) !== venueId) {
      throw new BadRequestException('Area belongs to a different venue than the lice');
    }
  }
}
