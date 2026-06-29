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
  skillName: string | null;
  skillColor: string | null;
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
        phases ( visibility_status, tournaments ( name ) )
      `,
      )
      .or(
        `red_registration_id.in.(${regIds.join(',')}),blue_registration_id.in.(${regIds.join(',')})`,
      )
      .order('scheduled_at', { ascending: true });

    if (!matches) return [];

    const mapped = (matches as Array<Record<string, unknown>>).flatMap((m) => {
      const redReg = (m['red_registration_id'] as string | null) ?? null;
      const blueReg = (m['blue_registration_id'] as string | null) ?? null;
      const isRed = redReg !== null && regIds.includes(redReg);
      const pool = m['pools'] as { name: string } | null;
      const lice = m['lices'] as { name: string } | null;
      const phase = m['phases'] as {
        visibility_status?: string | null;
        tournaments: { name: string } | null;
      } | null;
      if (phase?.visibility_status !== 'published') return [];

      return [
        {
          id: m['id'] as string,
          matchNumberLabel: (m['match_number_label'] as string | null) ?? '',
          status: m['status'] as string,
          scheduledAt: (m['scheduled_at'] as string | null) ?? null,
          opponentRegId: isRed ? blueReg : redReg,
          redScore: (m['red_score'] as number) ?? 0,
          blueScore: (m['blue_score'] as number) ?? 0,
          isRed,
          poolName: pool?.name ?? null,
          tournamentName: phase?.tournaments?.name ?? null,
          liceName: lice?.name ?? null,
        },
      ];
    });

    // Resolve opponent display names in one batched lookup (the side the
    // viewer is NOT registered on). Finishes the T-608 follow-up.
    const opponentNames = await this.resolveRegistrationNames(
      mapped.map((x) => x.opponentRegId).filter((id): id is string => Boolean(id)),
    );

    return mapped.map(({ opponentRegId, ...rest }) => ({
      ...rest,
      opponentName: opponentRegId ? (opponentNames.get(opponentRegId) ?? null) : null,
      opponentClub: null,
    }));
  }

  /** Batched registration_id → "Given Family" (falls back to global display name). */
  private async resolveRegistrationNames(regIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(regIds)];
    if (unique.length === 0) return new Map();
    const { data } = await this.supabase.service
      .from('registrations')
      .select('id, persons ( given_name, family_name, global_persons ( display_name ) )')
      .in('id', unique);
    const rows = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
    const map = new Map<string, string>();
    for (const r of rows) {
      const personRaw = r['persons'];
      const person = (Array.isArray(personRaw) ? personRaw[0] : personRaw) as Record<
        string,
        unknown
      > | null;
      if (!person) continue;
      const given = ((person['given_name'] as string | null) ?? '').trim();
      const family = ((person['family_name'] as string | null) ?? '').trim();
      const gpRaw = person['global_persons'];
      const gp = (Array.isArray(gpRaw) ? gpRaw[0] : gpRaw) as { display_name?: string } | null;
      const name = `${given} ${family}`.trim() || (gp?.display_name ?? '').trim();
      if (name) map.set(String(r['id']), name);
    }
    return map;
  }

  private async fetchRefereeSlots(eventId: string, personId: string): Promise<RefereeSlot[]> {
    // Post-0063: referee_assignments keys on global_persons.id, but this
    // controller takes the event-scoped persons.id. Resolve via
    // persons.global_person_id; absent link → no referee slots.
    const { data: personLink } = await this.supabase.service
      .from('persons')
      .select('global_person_id')
      .eq('id', personId)
      .maybeSingle();
    const globalPersonId =
      (personLink as { global_person_id: string | null } | null)?.global_person_id ?? null;
    if (!globalPersonId) return [];

    const { data } = await this.supabase.service
      .from('referee_assignments')
      .select(
        `
        role,
        matches (
          id, match_number_label, scheduled_at,
          pools ( name ),
          phases ( visibility_status, tournaments ( name ) )
        )
      `,
      )
      .eq('person_id', globalPersonId)
      .eq('event_id', eventId);

    if (!data) return [];

    const slots: RefereeSlot[] = (data as Array<Record<string, unknown>>).flatMap((a) => {
      const match = a['matches'] as Record<string, unknown> | null;
      const pool = match?.['pools'] as { name: string } | null;
      const phase = match?.['phases'] as {
        visibility_status?: string | null;
        tournaments: { name: string } | null;
      } | null;
      if (phase?.visibility_status !== 'published') return [];

      return {
        matchId: (match?.['id'] as string) ?? '',
        matchNumberLabel: (match?.['match_number_label'] as string | null) ?? '',
        scheduledAt: (match?.['scheduled_at'] as string | null) ?? null,
        role: a['role'] as string,
        poolName: pool?.name ?? null,
        tournamentName: phase?.tournaments?.name ?? null,
        skillName: null,
        skillColor: null,
      };
    });

    // Enrich with the referee skill name + colour (role holds referee_skills.id).
    const roleIds = [...new Set(slots.map((s) => s.role).filter((x): x is string => !!x))];
    if (roleIds.length > 0) {
      const { data: skills } = await this.supabase.service
        .from('referee_skills')
        .select('id, name, color')
        .in('id', roleIds);
      const byId = new Map<string, { name: string; color: string }>();
      for (const s of Array.isArray(skills) ? (skills as Array<Record<string, unknown>>) : []) {
        byId.set(String(s['id']), {
          name: String(s['name'] ?? ''),
          color: String(s['color'] ?? ''),
        });
      }
      for (const slot of slots) {
        const sk = byId.get(slot.role);
        if (sk) {
          slot.skillName = sk.name;
          slot.skillColor = sk.color;
        }
      }
    }
    return slots;
  }

  private async fetchWorkshops(_eventId: string, personId: string): Promise<WorkshopEnrollment[]> {
    // `user_id` is the event-scoped persons.id, so filtering by it already
    // scopes to this event — there is no `event_id` column on enrollments.
    const { data } = await this.supabase.service
      .from('workshop_enrollments')
      .select(
        `
        workshop_sessions (
          id, starts_at, ends_at, location_label,
          workshops ( title )
        )
      `,
      )
      .eq('user_id', personId);

    if (!data) return [];

    return (data as Array<Record<string, unknown>>).map((e) => {
      const sessionRaw = e['workshop_sessions'];
      const session = (Array.isArray(sessionRaw) ? sessionRaw[0] : sessionRaw) as Record<
        string,
        unknown
      > | null;
      const workshopRaw = session?.['workshops'];
      const workshop = (Array.isArray(workshopRaw) ? workshopRaw[0] : workshopRaw) as {
        title?: string;
      } | null;

      return {
        workshopId: (session?.['id'] as string) ?? '',
        workshopName: workshop?.title ?? '',
        sessionStart: (session?.['starts_at'] as string | null) ?? null,
        sessionEnd: (session?.['ends_at'] as string | null) ?? null,
        location: (session?.['location_label'] as string | null) ?? null,
      };
    });
  }
}
