/**
 * public-schedule.service.ts — T-608
 *
 * Returns any Person's schedule with privacy filters applied.
 * Shared between:
 *   - GET /events/:eventId/people/:personId/schedule (public)
 *   - GET /my-schedule (T-805, authenticated)
 *
 * AC:
 *   - matches + referee_slots always included
 *   - workshops included unless hide_workshops_publicly=true AND not own person
 *   - email never returned
 *   - 100ms p95 target (relies on DB indexes on person_id + event_id)
 */

import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { PrivacyService } from './privacy.service';

export interface ScheduleMatch {
  id: string;
  matchNumberLabel: string;
  status: string;
  scheduledAt: string | null;
  opponentName: string | null;
  opponentClub: string | null;
  redScore: number;
  blueScore: number;
  isRed: boolean;
  poolName: string | null;
  tournamentName: string | null;
  liceName: string | null;
}

export interface RefereeSlot {
  matchId: string;
  matchNumberLabel: string;
  scheduledAt: string | null;
  role: string;
  poolName: string | null;
  tournamentName: string | null;
}

export interface WorkshopEnrollment {
  workshopId: string;
  workshopName: string;
  sessionStart: string | null;
  sessionEnd: string | null;
  location: string | null;
}

export interface PersonSchedule {
  personId: string;
  matches: ScheduleMatch[];
  refereeSlots: RefereeSlot[];
  workshops: WorkshopEnrollment[] | null; // null = hidden by privacy
}

@Injectable()
export class PublicScheduleService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly privacy: PrivacyService,
  ) {}

  async getSchedule(
    eventId: string,
    personId: string,
    requesterPersonId: string | null,
  ): Promise<PersonSchedule> {
    const [matches, refereeSlots, showWorkshops] = await Promise.all([
      this.fetchMatches(eventId, personId),
      this.fetchRefereeSlots(eventId, personId),
      this.privacy.canSeeWorkshops(personId, requesterPersonId),
    ]);

    const workshops = showWorkshops ? await this.fetchWorkshops(eventId, personId) : null;

    return { personId, matches, refereeSlots, workshops };
  }

  // ── Private fetchers ─────────────────────────────────────────────────────────

  private async fetchMatches(eventId: string, personId: string): Promise<ScheduleMatch[]> {
    // Find registrations for this person in this event's tournaments
    const { data: regs } = await this.supabase.service
      .from('registrations')
      .select('id, tournament_id')
      .eq('person_id', personId);

    if (!regs || regs.length === 0) return [];

    const regIds = (regs as Array<{ id: string }>).map((r) => r.id);

    const { data: matches } = await this.supabase.service
      .from('matches')
      .select(
        `
        id, match_number_label, status, scheduled_at,
        red_score, blue_score,
        red_registration_id, blue_registration_id,
        pools ( name ),
        lices ( name ),
        phases ( tournaments ( name ) )
      `,
      )
      .or(
        `red_registration_id.in.(${regIds.join(',')}),blue_registration_id.in.(${regIds.join(',')})`,
      )
      .order('scheduled_at', { ascending: true });

    if (!matches) return [];

    return (matches as Array<Record<string, unknown>>).map((m) => {
      const isRed = regIds.includes(m['red_registration_id'] as string);
      const pool = m['pools'] as { name: string } | null;
      const lice = m['lices'] as { name: string } | null;
      const phase = m['phases'] as { tournaments: { name: string } | null } | null;

      return {
        id: m['id'] as string,
        matchNumberLabel: (m['match_number_label'] as string | null) ?? '',
        status: m['status'] as string,
        scheduledAt: (m['scheduled_at'] as string | null) ?? null,
        opponentName: null, // TODO: resolve opponent name from registration→person
        opponentClub: null,
        redScore: (m['red_score'] as number) ?? 0,
        blueScore: (m['blue_score'] as number) ?? 0,
        isRed,
        poolName: pool?.name ?? null,
        tournamentName: phase?.tournaments?.name ?? null,
        liceName: lice?.name ?? null,
      };
    });
  }

  private async fetchRefereeSlots(eventId: string, personId: string): Promise<RefereeSlot[]> {
    const { data } = await this.supabase.service
      .from('referee_assignments')
      .select(
        `
        role,
        matches (
          id, match_number_label, scheduled_at,
          pools ( name ),
          phases ( tournaments ( name ) )
        )
      `,
      )
      .eq('person_id', personId)
      .eq('event_id', eventId);

    if (!data) return [];

    return (data as Array<Record<string, unknown>>).map((a) => {
      const match = a['matches'] as Record<string, unknown> | null;
      const pool = match?.['pools'] as { name: string } | null;
      const phase = match?.['phases'] as { tournaments: { name: string } | null } | null;

      return {
        matchId: (match?.['id'] as string) ?? '',
        matchNumberLabel: (match?.['match_number_label'] as string | null) ?? '',
        scheduledAt: (match?.['scheduled_at'] as string | null) ?? null,
        role: a['role'] as string,
        poolName: pool?.name ?? null,
        tournamentName: phase?.tournaments?.name ?? null,
      };
    });
  }

  private async fetchWorkshops(eventId: string, personId: string): Promise<WorkshopEnrollment[]> {
    const { data } = await this.supabase.service
      .from('workshop_enrollments')
      .select(
        `
        workshop_sessions (
          id, start_time, end_time, location,
          workshops ( name )
        )
      `,
      )
      .eq('person_id', personId)
      .eq('event_id', eventId);

    if (!data) return [];

    return (data as Array<Record<string, unknown>>).map((e) => {
      const session = e['workshop_sessions'] as Record<string, unknown> | null;
      const workshop = session?.['workshops'] as { name: string } | null;

      return {
        workshopId: (session?.['id'] as string) ?? '',
        workshopName: workshop?.name ?? '',
        sessionStart: (session?.['start_time'] as string | null) ?? null,
        sessionEnd: (session?.['end_time'] as string | null) ?? null,
        location: (session?.['location'] as string | null) ?? null,
      };
    });
  }
}
