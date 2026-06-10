import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { buildRoundCode } from '../matches/round-code.helper';

export interface ScheduleGridMatch {
  id: string;
  matchNumberLabel: string;
  /**
   * Canonical match code via formatRoundCode (LSW-P1-ML1-PA-M1 for
   * pools, LSW-B-QF-M1 for brackets). Built per-row in the service
   * so the sidebar + grid both read the same identifier the
   * scoring app and exports already show.
   */
  roundCode: string;
  status: string;
  liceId: string | null;
  scheduledAt: string | null;
  redFighterName: string | null;
  blueFighterName: string | null;
  redRegistrationId: string;
  blueRegistrationId: string;
  tournamentName: string | null;
  /** Tournament identity colour (ColorToken string). Lets the grid
   *  tint every match card by its parent tournament so the schedule
   *  reads as a horizontal flow of tournaments. Null when the
   *  tournament has no color set; the FE's tint helpers fall back
   *  to the default token. */
  tournamentColor: string | null;
  durationMinutes: number;
  /** 'pool' / 'single_elim' / 'double_elim' — drives the bracket-vs-pool chip on the grid. */
  phaseType: string | null;
  /** Populated for pool-type matches so the grid can group + colour-tint
   *  matches by pool. Null for bracket / finals matches. */
  poolId: string | null;
  poolName: string | null;
}

interface PhaseRow {
  id: string;
  type: string;
  tournament_id: string;
  /**
   * Bracket-type phases stash `bracketSize` (and `mainBracketSize` for
   * double-elim) here at bracket-generation time — see
   * phases.service.ts:412+. There is no `tournaments.bracket_size`
   * column despite the name; the canonical source is this jsonb field.
   */
  config_json: Record<string, unknown> | null;
}

interface TournamentRow {
  id: string;
  name: string;
  weapon: string | null;
  color: string | null;
}

interface MatchRow {
  id: string;
  match_number_label: string | null;
  status: string | null;
  lice_id: string | null;
  scheduled_at: string | null;
  phase_id: string | null;
  pool_id: string | null;
  bracket_slot_id: string | null;
  red_registration_id: string | null;
  blue_registration_id: string | null;
}

interface PoolRow {
  id: string;
  name: string;
  sort_order: number | null;
}

interface BracketSlotRow {
  id: string;
  round: number | null;
  source_a_type: string | null;
  source_a_ref: string | null;
  source_b_type: string | null;
  source_b_ref: string | null;
}

interface BracketSlotSourceInfo {
  round: number | null;
  sourceAType: string | null;
  sourceARef: string | null;
  sourceBType: string | null;
  sourceBRef: string | null;
}

/**
 * Build a placeholder fighter label for a bracket slot whose
 * registration hasn't been resolved yet. `source_a_ref` strings are
 * already self-describing (e.g. 'winner of R1P1') so we just
 * title-case the leading verb. Returns null when we have nothing
 * meaningful to show — caller falls back to '?' in that case.
 */
export function formatBracketPlaceholder(type: string | null, ref: string | null): string | null {
  if (!type || !ref) return null;
  if (type === 'winner_of') return `Winner of ${ref.replace(/^winner of /i, '')}`;
  if (type === 'loser_of') return `Loser of ${ref.replace(/^loser of /i, '')}`;
  if (type === 'seed') return `Seed ${ref}`;
  return ref;
}

interface ViewNameRow {
  match_id: string;
  red_name: string | null;
  blue_name: string | null;
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
      .select('id, name, weapon, color')
      .eq('event_id', eventId);
    if (tournamentsErr) throw new BadRequestException(tournamentsErr.message);
    const tournaments = ((tournamentsData ?? []) as TournamentRow[]).filter((t) => Boolean(t.id));
    if (tournaments.length === 0) return [];
    const tournamentIds = tournaments.map((t) => t.id);
    const tournamentById = new Map(tournaments.map((t) => [t.id, t]));

    // 2. Phases under those tournaments — keeps both pool and bracket phases.
    // config_json carries each bracket phase's `bracketSize`, needed by
    // buildRoundCode to resolve round labels (R16/QF/SF/F) instead of B{round}.
    const { data: phasesData, error: phasesErr } = await this.supabase.service
      .from('phases')
      .select('id, type, tournament_id, config_json')
      .in('tournament_id', tournamentIds);
    if (phasesErr) throw new BadRequestException(phasesErr.message);
    const phases = ((phasesData ?? []) as PhaseRow[]).filter((p) => Boolean(p.id));
    if (phases.length === 0) return [];
    const phaseIds = phases.map((p) => p.id);
    const phaseById = new Map(phases.map((p) => [p.id, p]));
    const bracketSizeByPhaseId = new Map<string, number | null>();
    for (const p of phases) {
      if (p.type === 'pool') continue;
      const cfg = p.config_json ?? null;
      const size = (cfg?.['bracketSize'] ?? cfg?.['mainBracketSize']) as number | undefined;
      bracketSizeByPhaseId.set(p.id, typeof size === 'number' ? size : null);
    }

    // 3. Matches under those phases — phase-agnostic (no `eq('type', ...)`).
    const { data: matchesData, error: matchesErr } = await this.supabase.service
      .from('matches')
      .select(
        'id, match_number_label, status, lice_id, scheduled_at, phase_id, pool_id, bracket_slot_id, red_registration_id, blue_registration_id',
      )
      .in('phase_id', phaseIds)
      .order('scheduled_at', { ascending: true, nullsFirst: false })
      .order('match_number_label', { ascending: true });
    if (matchesErr) throw new BadRequestException(matchesErr.message);
    const matches = (matchesData ?? []) as MatchRow[];
    if (matches.length === 0) return [];

    // 3b. Pools batch lookup — sort_order feeds the canonical
    // roundCode (LSW-P{sort_order+1}-…). Name drives the
    // per-pool colour tint and the clear-pool handle.
    const poolIds = Array.from(
      new Set(matches.map((m) => m.pool_id).filter((id): id is string => Boolean(id))),
    );
    const poolById = new Map<string, PoolRow>();
    if (poolIds.length > 0) {
      const { data: poolsData } = await this.supabase.service
        .from('pools')
        .select('id, name, sort_order')
        .in('id', poolIds);
      for (const p of (poolsData ?? []) as PoolRow[]) {
        poolById.set(p.id, p);
      }
    }

    // 3c. Bracket slots batch lookup — feeds bracketRound into the
    // canonical roundCode (LSW-B-QF-M1 etc.) and source_a/b into the
    // "Winner of R1P1" placeholder labels for unfilled bracket
    // cards (slot waiting on pool results / prior-round resolution).
    const bracketSlotIds = Array.from(
      new Set(matches.map((m) => m.bracket_slot_id).filter((id): id is string => Boolean(id))),
    );
    const bracketSourceBySlotId = new Map<string, BracketSlotSourceInfo>();
    if (bracketSlotIds.length > 0) {
      const { data: slotsData } = await this.supabase.service
        .from('bracket_slots')
        .select('id, round, source_a_type, source_a_ref, source_b_type, source_b_ref')
        .in('id', bracketSlotIds);
      for (const s of (slotsData ?? []) as BracketSlotRow[]) {
        bracketSourceBySlotId.set(s.id, {
          round: s.round,
          sourceAType: s.source_a_type,
          sourceARef: s.source_a_ref,
          sourceBType: s.source_b_type,
          sourceBRef: s.source_b_ref,
        });
      }
    }

    // 4. Fighter display names via the canonical tournament-matches view —
    // the same registrations→persons join the public pool view + scoring
    // summary use. This replaces a manual registrations→persons batch lookup
    // that returned null for pool matches (the "? vs ?" tooltip bug) while
    // the view resolved them correctly. Keyed by match_id; bracket
    // placeholders still fill the gaps for unresolved slots. `.limit()`
    // bypasses PostgREST's default 1000-row cap for large events.
    const matchIds = matches.map((m) => m.id);
    const nameByMatchId = new Map<string, { red: string | null; blue: string | null }>();
    const { data: nameRows } = await this.supabase.service
      .from('vw_tournament_query_matches')
      .select('match_id, red_name, blue_name')
      .in('match_id', matchIds)
      .limit(matchIds.length);
    for (const r of (nameRows ?? []) as ViewNameRow[]) {
      nameByMatchId.set(r.match_id, {
        red: r.red_name?.trim() || null,
        blue: r.blue_name?.trim() || null,
      });
    }

    return matches.map((m): ScheduleGridMatch => {
      const phase = m.phase_id ? phaseById.get(m.phase_id) : null;
      const tournament = phase ? (tournamentById.get(phase.tournament_id) ?? null) : null;
      const tournamentName = tournament?.name ?? null;
      const names = nameByMatchId.get(m.id);
      const pool = m.pool_id ? (poolById.get(m.pool_id) ?? null) : null;
      const slotSource = m.bracket_slot_id
        ? (bracketSourceBySlotId.get(m.bracket_slot_id) ?? null)
        : null;

      // Pool sort_order is 0-indexed in the schema; the canonical
      // code uses 1-indexed pool numbers (P1, P2, …).
      const poolNumber = pool && typeof pool.sort_order === 'number' ? pool.sort_order + 1 : null;

      const bracketSize = phase ? (bracketSizeByPhaseId.get(phase.id) ?? null) : null;

      const roundCode = buildRoundCode({
        weapon: tournament?.weapon ?? null,
        poolNumber,
        bracketRound: slotSource?.round ?? null,
        bracketSize,
        matchNumberLabel: m.match_number_label,
        roundNumber: null,
      });

      // Bracket slots waiting on prior-round / pool results carry
      // their source intent (winner_of/loser_of/seed + ref). Surface
      // it as the fighter label so the operator sees "Winner of
      // R1P1" instead of a blank "?".
      const redFighterName =
        names?.red ??
        (slotSource
          ? formatBracketPlaceholder(slotSource.sourceAType, slotSource.sourceARef)
          : null);
      const blueFighterName =
        names?.blue ??
        (slotSource
          ? formatBracketPlaceholder(slotSource.sourceBType, slotSource.sourceBRef)
          : null);

      return {
        id: m.id,
        matchNumberLabel: m.match_number_label ?? '',
        roundCode,
        status: m.status ?? 'scheduled',
        liceId: m.lice_id,
        scheduledAt: m.scheduled_at,
        redFighterName,
        blueFighterName,
        redRegistrationId: m.red_registration_id ?? '',
        blueRegistrationId: m.blue_registration_id ?? '',
        tournamentName,
        tournamentColor: tournament?.color ?? null,
        durationMinutes: 5,
        phaseType: phase?.type ?? null,
        poolId: m.pool_id,
        poolName: pool?.name ?? null,
      };
    });
  }
}
