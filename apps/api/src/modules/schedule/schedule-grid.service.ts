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
  /** 'pool' / 'single_elim' / 'double_elim' — drives the bracket-vs-pool chip on the grid. */
  phaseType: string | null;
}

interface PhaseRow {
  id: string;
  type: string;
  tournament_id: string;
}

interface TournamentRow {
  id: string;
  name: string;
}

interface MatchRow {
  id: string;
  match_number_label: string | null;
  status: string | null;
  lice_id: string | null;
  scheduled_at: string | null;
  phase_id: string | null;
  red_registration_id: string | null;
  blue_registration_id: string | null;
}

interface RegistrationRow {
  id: string;
  person_id: string | null;
}

interface PersonRow {
  id: string;
  display_name: string | null;
  given_name: string | null;
  family_name: string | null;
}

@Injectable()
export class ScheduleGridService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Return every match across every phase (pool / bracket / finals) for the
   * event, with enough hydration for the admin schedule grid:
   *   - `liceId` + `scheduledAt` for placement on the canvas
   *   - registration display names for hover tooltips
   *   - tournament name + phase type for the per-row label
   *
   * Implementation: phase IDs are resolved in code from the tournaments table
   * rather than via a PostgREST nested-embedded filter, which silently
   * returned zero rows in some environments. Each subsequent fetch is a
   * straight `in('column', ids)` lookup — robust and easy to reason about.
   *
   * Matches with `scheduled_at IS NULL` are returned too — the frontend uses
   * them to populate the "Unscheduled" sidebar.
   */
  async listEventSchedule(eventId: string): Promise<ScheduleGridMatch[]> {
    // 1. Tournaments for this event.
    const { data: tournamentsData, error: tournamentsErr } = await this.supabase.service
      .from('tournaments')
      .select('id, name')
      .eq('event_id', eventId);
    if (tournamentsErr) throw new BadRequestException(tournamentsErr.message);
    const tournaments = ((tournamentsData ?? []) as TournamentRow[]).filter((t) => Boolean(t.id));
    if (tournaments.length === 0) return [];
    const tournamentIds = tournaments.map((t) => t.id);
    const tournamentNameById = new Map(tournaments.map((t) => [t.id, t.name]));

    // 2. Phases under those tournaments — keeps both pool and bracket phases.
    const { data: phasesData, error: phasesErr } = await this.supabase.service
      .from('phases')
      .select('id, type, tournament_id')
      .in('tournament_id', tournamentIds);
    if (phasesErr) throw new BadRequestException(phasesErr.message);
    const phases = ((phasesData ?? []) as PhaseRow[]).filter((p) => Boolean(p.id));
    if (phases.length === 0) return [];
    const phaseIds = phases.map((p) => p.id);
    const phaseById = new Map(phases.map((p) => [p.id, p]));

    // 3. Matches under those phases — phase-agnostic (no `eq('type', ...)`).
    const { data: matchesData, error: matchesErr } = await this.supabase.service
      .from('matches')
      .select(
        'id, match_number_label, status, lice_id, scheduled_at, phase_id, red_registration_id, blue_registration_id',
      )
      .in('phase_id', phaseIds)
      .order('scheduled_at', { ascending: true, nullsFirst: false })
      .order('match_number_label', { ascending: true });
    if (matchesErr) throw new BadRequestException(matchesErr.message);
    const matches = (matchesData ?? []) as MatchRow[];
    if (matches.length === 0) return [];

    // 4. Registrations → persons batch lookup for display names.
    const registrationIds = Array.from(
      new Set(
        matches
          .flatMap((m) => [m.red_registration_id, m.blue_registration_id])
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const personByRegId = new Map<string, PersonRow>();
    if (registrationIds.length > 0) {
      const { data: regsData } = await this.supabase.service
        .from('registrations')
        .select('id, person_id')
        .in('id', registrationIds);
      const regs = (regsData ?? []) as RegistrationRow[];
      const personIds = Array.from(
        new Set(regs.map((r) => r.person_id).filter((id): id is string => Boolean(id))),
      );

      if (personIds.length > 0) {
        const { data: personsData } = await this.supabase.service
          .from('persons')
          .select('id, display_name, given_name, family_name')
          .in('id', personIds);
        const personById = new Map<string, PersonRow>(
          ((personsData ?? []) as PersonRow[]).map((p) => [p.id, p]),
        );
        for (const reg of regs) {
          if (!reg.person_id) continue;
          const person = personById.get(reg.person_id);
          if (person) personByRegId.set(reg.id, person);
        }
      }
    }

    return matches.map((m): ScheduleGridMatch => {
      const phase = m.phase_id ? phaseById.get(m.phase_id) : null;
      const tournamentName = phase ? (tournamentNameById.get(phase.tournament_id) ?? null) : null;
      const red = m.red_registration_id ? personByRegId.get(m.red_registration_id) : null;
      const blue = m.blue_registration_id ? personByRegId.get(m.blue_registration_id) : null;
      return {
        id: m.id,
        matchNumberLabel: m.match_number_label ?? '',
        status: m.status ?? 'scheduled',
        liceId: m.lice_id,
        scheduledAt: m.scheduled_at,
        redFighterName: formatName(red),
        blueFighterName: formatName(blue),
        redRegistrationId: m.red_registration_id ?? '',
        blueRegistrationId: m.blue_registration_id ?? '',
        tournamentName,
        durationMinutes: 5,
        phaseType: phase?.type ?? null,
      };
    });
  }
}

function formatName(person: PersonRow | null | undefined): string | null {
  if (!person) return null;
  const composed = `${person.given_name ?? ''} ${person.family_name ?? ''}`.trim();
  return person.display_name?.trim() || composed || null;
}
