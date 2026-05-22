import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export interface ScheduleGridMatch {
  id: string;
  matchNumberLabel: string;
  status: string;
  liceId: string | null;
  scheduledAt: string | null;
  redFighterName: string | null;
  blueFighterName: string | null;
  redRegistrationId: string;
  blueRegistrationId: string;
  tournamentName: string | null;
  durationMinutes: number;
}

@Injectable()
export class ScheduleGridService {
  constructor(private readonly supabase: SupabaseService) {}

  async listEventSchedule(eventId: string): Promise<ScheduleGridMatch[]> {
    const { data, error } = await this.supabase.service
      .from('matches')
      .select(
        `
        id,
        match_number_label,
        status,
        lice_id,
        scheduled_at,
        red_registration_id,
        blue_registration_id,
        red:registrations!matches_red_registration_id_fkey(id, persons(display_name)),
        blue:registrations!matches_blue_registration_id_fkey(id, persons(display_name)),
        phases!inner(tournaments!inner(id, name, event_id))
      `,
      )
      .eq('phases.tournaments.event_id', eventId)
      .order('scheduled_at', { ascending: true, nullsFirst: false })
      .order('match_number_label', { ascending: true });

    if (error) throw new BadRequestException(error.message);

    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => this.mapMatch(row));
  }

  private mapMatch(row: Record<string, unknown>): ScheduleGridMatch {
    const red = row['red'] as { persons?: { display_name?: string | null } | null } | null;
    const blue = row['blue'] as { persons?: { display_name?: string | null } | null } | null;
    const phases = row['phases'] as { tournaments?: { name?: string | null } | null } | null;

    return {
      id: row['id'] as string,
      matchNumberLabel: (row['match_number_label'] as string | null) ?? '',
      status: (row['status'] as string | null) ?? 'scheduled',
      liceId: (row['lice_id'] as string | null) ?? null,
      scheduledAt: (row['scheduled_at'] as string | null) ?? null,
      redFighterName: red?.persons?.display_name ?? null,
      blueFighterName: blue?.persons?.display_name ?? null,
      redRegistrationId: row['red_registration_id'] as string,
      blueRegistrationId: row['blue_registration_id'] as string,
      tournamentName: phases?.tournaments?.name ?? null,
      durationMinutes: 5,
    };
  }
}
