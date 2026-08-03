import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  BlockDiagnostic,
  GenerateResult,
  ProgrammeBlock,
  ProgrammeSuggestion,
  SuggestConfig,
} from '@myclash/types';
import { SupabaseService } from '../supabase/supabase.service';
import { scheduleMatches } from '../schedule/match-scheduler';
import { poolBottleneckMinutes } from './pool-bottleneck';
import { cascadeBlockShift } from './block-cascade';
// A pure zod schema (its only dependency is zod), so this is a plain file
// import and NOT a ProgrammeModule → SwissModule edge. SwissCoreModule imports
// ProgrammeModule, so a real module edge here would close a cycle.
import { parseSwissConfig } from '../swiss/dto/swiss-config.dto';
import type {
  CreateBlockDto,
  SaveProgrammeDto,
  ScheduleGroupDto,
  SuggestProgrammeDto,
  UpdateBlockLabelDto,
} from './dto/programme.dto';

function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function minToTime(min: number): string {
  const clamped = Math.max(0, Math.min(min, 23 * 60 + 59));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * `YYYY-MM-DD` for the WALL-CLOCK day a Date falls on.
 *
 * Not `toISOString().slice(0, 10)`, which is the UTC day: an event day whose
 * 09:00 local start is stored as 08:00Z is the same date here but would drift
 * across midnight for late-evening blocks in a positive-offset zone. The
 * scheduler places matches with `setHours` (container-local `TZ`), so every
 * read-back that compares days has to speak the same clock.
 */
function localDateIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Normalise the `HH:MM:SS[.sss]` strings PostgREST returns for `TIME`
 * columns down to the `HH:MM` form the DTO regex (and the FE
 * `<input type="time">`) expects. Pass-through for already-trimmed
 * values; defensive against null / undefined inputs.
 */
function trimSeconds(raw: string | null | undefined): string {
  if (!raw) return '';
  return /^\d{2}:\d{2}:/.test(raw) ? raw.slice(0, 5) : raw;
}

/** A bracket (non-pool) match hydrated with its resolved bracket coordinates. */
interface BracketMatchRow {
  id: string;
  red_registration_id: string;
  blue_registration_id: string;
  pool_id: string | null;
  pool_sort_order: number | null;
  match_number_label: string | null;
  phase_id: string;
  phase_type: string | null;
  bracket_round: number | null;
  bracket_position: number | null;
}

function computeNeededMin(
  matchCount: number,
  parallelLice: number,
  durationMin: number,
  gapSec: number,
): number {
  if (matchCount === 0 || parallelLice === 0) return 0;
  return Math.ceil(matchCount / parallelLice) * (durationMin + gapSec / 60);
}

/**
 * Pick the scheduler affinity for a competition block. Pools stay strict
 * (whole pool on one lice). An elimination bracket with derivable slot
 * coordinates uses branch-aware grouping — each quarter-final sub-tree on one
 * lice for single-elim, the winners-bracket sub-trees for double-elim (its
 * losers bracket converges, since it consumes WB losers). Anything else
 * (swiss, no tree) falls back to greedy.
 */
export function decidePoolAffinity(input: {
  isPool: boolean;
  matches: Array<{
    bracket_round?: number | null;
    bracket_position?: number | null;
    phase_type?: string | null;
  }>;
}): 'strict' | 'off' | 'bracket-branch' {
  if (input.isPool) return 'strict';
  const hasTree = input.matches.some((m) => m.bracket_round != null && m.bracket_position != null);
  const allElim =
    input.matches.length > 0 &&
    input.matches.every((m) => m.phase_type === 'single_elim' || m.phase_type === 'double_elim');
  return hasTree && allElim ? 'bracket-branch' : 'off';
}

@Injectable()
export class ProgrammeService {
  constructor(private readonly supabase: SupabaseService) {}

  // ── List ───────────────────────────────────────────────────────────────────

  async listBlocks(eventId: string): Promise<ProgrammeBlock[]> {
    const { data, error } = await this.supabase.service
      .from('event_programme_blocks')
      .select('*')
      .eq('event_id', eventId)
      .order('day_index', { ascending: true })
      .order('sort_order', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((r) => this.mapBlock(r as Record<string, unknown>));
  }

  // ── Save (bulk replace) ────────────────────────────────────────────────────

  async saveBlocks(eventId: string, dto: SaveProgrammeDto): Promise<ProgrammeBlock[]> {
    this.validateBlocks(dto.blocks);

    const { error: delError } = await this.supabase.service
      .from('event_programme_blocks')
      .delete()
      .eq('event_id', eventId);
    if (delError) throw new BadRequestException(delError.message);

    if (dto.blocks.length === 0) return [];

    const inserts = dto.blocks.map((b, i) => {
      const row: Record<string, unknown> = {
        event_id: eventId,
        day_index: b.dayIndex,
        sort_order: i,
        block_type: b.blockType,
        label: b.label,
        competition_id: b.competitionId ?? null,
        competition_phase: b.competitionPhase ?? null,
        workshop_id: b.workshopId ?? null,
        lice_count: b.liceCount,
        start_time: b.startTime,
        end_time: b.endTime,
        match_gap_seconds: b.matchGapSeconds,
        match_duration_minutes: b.matchDurationMinutes,
        min_rest_minutes: b.minRestMinutes,
        color_hex: b.colorHex ?? null,
      };
      if (b.id && !b.id.startsWith('new-')) row['id'] = b.id;
      return row;
    });

    const { data, error } = await this.supabase.service
      .from('event_programme_blocks')
      .insert(inserts)
      .select('*');
    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((r) => this.mapBlock(r as Record<string, unknown>));
  }

  // ── Reset everything ───────────────────────────────────────────────────────

  /**
   * Nuclear schedule reset. Drops every programme block AND clears
   * `scheduled_at` / `lice_id` on every match across the event's
   * tournaments. The tournaments / pools / brackets themselves stay
   * — only their time + lice assignments are erased.
   *
   * Designed to back the operator's "Reset" button on the programme
   * tab. Two sequential ops; if the matches update fails the
   * programme has already been deleted, which is acceptable (the
   * operator is asking to wipe state anyway).
   */
  async resetAll(eventId: string): Promise<{ programmeDeleted: number; matchesCleared: number }> {
    // 1. Drop every programme block.
    const { data: deletedBlocks, error: progErr } = await this.supabase.service
      .from('event_programme_blocks')
      .delete()
      .eq('event_id', eventId)
      .select('id');
    if (progErr) throw new BadRequestException(progErr.message);

    // 2. Resolve every match in the event's tournaments and null
    //    out the schedule fields. PostgREST can't span the
    //    tournaments → phases → matches join in a single UPDATE,
    //    so fan-out: tournament_ids → phase_ids → match update.
    const { data: tournaments, error: tErr } = await this.supabase.service
      .from('tournaments')
      .select('id')
      .eq('event_id', eventId);
    if (tErr) throw new BadRequestException(tErr.message);
    const tournamentIds = (tournaments ?? []).map((t) => (t as { id: string }).id);

    let matchesCleared = 0;
    if (tournamentIds.length > 0) {
      const { data: phases, error: phErr } = await this.supabase.service
        .from('phases')
        .select('id')
        .in('tournament_id', tournamentIds);
      if (phErr) throw new BadRequestException(phErr.message);
      const phaseIds = (phases ?? []).map((p) => (p as { id: string }).id);

      if (phaseIds.length > 0) {
        const { data: cleared, error: mErr } = await this.supabase.service
          .from('matches')
          .update({ scheduled_at: null, lice_id: null })
          .in('phase_id', phaseIds)
          .select('id');
        if (mErr) throw new BadRequestException(mErr.message);
        matchesCleared = (cleared ?? []).length;
      }
    }

    return { programmeDeleted: (deletedBlocks ?? []).length, matchesCleared };
  }

  // ── Suggest ────────────────────────────────────────────────────────────────

  async suggest(eventId: string, dto: SuggestProgrammeDto): Promise<ProgrammeSuggestion> {
    const config: SuggestConfig = {
      dayStartTime: dto.dayStartTime,
      dayEndTime: dto.dayEndTime,
      parallelLiceCount: dto.parallelLiceCount,
      poolMatchDurationMinutes: dto.poolMatchDurationMinutes,
      eliminationMatchDurationMinutes: dto.eliminationMatchDurationMinutes,
      finalsMatchDurationMinutes: dto.finalsMatchDurationMinutes,
      matchGapSeconds: dto.matchGapSeconds,
      minRestMinutes: dto.minRestMinutes,
      breakBetweenSessionsMinutes: dto.breakBetweenSessionsMinutes,
      middayBreakStart: dto.middayBreakStart,
      middayBreakEnd: dto.middayBreakEnd,
      registrationDurationMinutes: dto.registrationDurationMinutes,
      gearCheckDurationMinutes: dto.gearCheckDurationMinutes,
      refereeMeetingDurationMinutes: dto.refereeMeetingDurationMinutes,
    };
    return this.buildSuggestion(eventId, config);
  }

  private async buildSuggestion(eventId: string, cfg: SuggestConfig): Promise<ProgrammeSuggestion> {
    // Load lice count for defaults
    const { data: licesData } = await this.supabase.service
      .from('lices')
      .select('id')
      .eq('event_id', eventId);
    const liceCount = (licesData ?? []).length || 1;
    const parallelLice = Math.min(cfg.parallelLiceCount || liceCount, liceCount);
    // A Swiss bout is a group-stage bout, so it inherits the pool clock unless
    // the organiser sets its own. Optional on the DTO so payloads predating
    // the Swiss format keep working.
    const swissDurationMin = cfg.swissMatchDurationMinutes ?? cfg.poolMatchDurationMinutes;

    // Load tournaments
    const { data: tournamentsData } = await this.supabase.service
      .from('tournaments')
      .select('id, name')
      .eq('event_id', eventId)
      .order('sort_order', { ascending: true });
    const tournaments = (tournamentsData ?? []) as Array<{ id: string; name: string }>;

    // Count matches per tournament per phase type
    interface TournamentStats {
      id: string;
      name: string;
      poolMatchCount: number;
      /** Matches per pool, ordered by pool sort order — drives the strict
       *  one-pool-per-lice bottleneck estimate. */
      poolPerPoolCounts: number[];
      /**
       * Bouts the WHOLE Swiss phase will produce — `roundCount × ⌈entrants/2⌉`
       * — not the bouts that happen to exist yet. Rounds are paired one at a
       * time as the previous one completes, so sizing the block off existing
       * matches would reserve room for round 1 alone and leave every later
       * round with nowhere to land.
       */
      swissMatchCount: number;
      bracketMatchCount: number;
      /** Final-round bracket matches (gold + bronze) — carved into a Finals block. */
      finalsMatchCount: number;
    }
    const tournamentStats: TournamentStats[] = [];

    for (const t of tournaments) {
      const { data: phasesData } = await this.supabase.service
        .from('phases')
        // config_json carries the Swiss roundCount the block estimate needs.
        .select('id, type, config_json')
        .eq('tournament_id', t.id);
      const phases = (phasesData ?? []) as Array<{
        id: string;
        type: string;
        config_json?: unknown;
      }>;

      const poolPhaseIds = phases.filter((p) => p.type === 'pool').map((p) => p.id);

      let poolMatchCount = 0;
      let poolPerPoolCounts: number[] = [];
      if (poolPhaseIds.length > 0) {
        const { data: poolsData } = await this.supabase.service
          .from('pools')
          // sort_order lives HERE. `matches.pool_sort_order` does not exist, so
          // the per-pool query below 400'd and every pool count read as zero —
          // the estimate silently modelled an event with no pool matches.
          .select('id, sort_order')
          .in('phase_id', poolPhaseIds);
        const pools = (poolsData ?? []) as Array<{ id: string; sort_order: number | null }>;
        const sortOrderByPool = new Map(pools.map((p) => [p.id, p.sort_order ?? 0]));
        const poolIds = pools.map((p) => p.id);
        if (poolIds.length > 0) {
          // Per-pool match counts (ordered by pool sort order) so the
          // estimate models strict one-pool-per-lice placement — the busiest
          // lice, not total/lices. One row per match; tally in JS.
          const { data: poolMatchRows } = await this.supabase.service
            .from('matches')
            .select('pool_id')
            .in('pool_id', poolIds);
          const byPool = new Map<string, { count: number; sortOrder: number }>();
          for (const r of (poolMatchRows ?? []) as Array<{ pool_id: string | null }>) {
            if (!r.pool_id) continue;
            const cur = byPool.get(r.pool_id) ?? {
              count: 0,
              sortOrder: sortOrderByPool.get(r.pool_id) ?? 0,
            };
            cur.count += 1;
            byPool.set(r.pool_id, cur);
          }
          poolPerPoolCounts = [...byPool.values()]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((v) => v.count);
          poolMatchCount = poolPerPoolCounts.reduce((sum, c) => sum + c, 0);
        }
      }

      // Bracket matches, split into elimination (earlier rounds) and finals
      // (the highest round — gold + bronze). Shares loadBracketMatches with
      // fetchCompetitionMatches so the estimate and the grid agree on which
      // matches are finals.
      const { rows: bracketRows, finalRound } = await this.loadBracketMatches(t.id);
      const bracketMatchCount = bracketRows.length;
      const finalsMatchCount =
        finalRound == null ? 0 : bracketRows.filter((r) => r.bracket_round === finalRound).length;

      const swissMatchCount = await this.estimateSwissMatchCount(
        phases.filter((p) => p.type === 'swiss'),
      );

      tournamentStats.push({
        id: t.id,
        name: t.name,
        poolMatchCount,
        poolPerPoolCounts,
        swissMatchCount,
        bracketMatchCount,
        finalsMatchCount,
      });
    }

    // Workshops are scheduled on the dedicated workshop board, not the event
    // programme — the generator no longer emits workshop blocks/sessions.

    // Build blocks with simple sequential placement
    const blocks: ProgrammeBlock[] = [];
    const warnings: Array<{
      blockId: string;
      message: string;
      suggestedEndTime: string;
      overflowMinutes: number;
    }> = [];
    let cursor = timeToMin(cfg.dayStartTime);
    const dayEndMin = timeToMin(cfg.dayEndTime);
    const middayStartMin = timeToMin(cfg.middayBreakStart);
    const middayEndMin = timeToMin(cfg.middayBreakEnd);
    let dayIndex = 0;
    let sortOrder = 0;
    let middayInserted = false;

    const push = (
      partial: Omit<
        ProgrammeBlock,
        'id' | 'eventId' | 'sortOrder' | 'generatedAt' | 'colorHex' | 'minRestMinutes'
      > & { minRestMinutes?: number },
      neededMin = 0,
    ): void => {
      const b: ProgrammeBlock = {
        id: `new-${sortOrder}`,
        eventId,
        sortOrder: sortOrder++,
        colorHex: null,
        generatedAt: null,
        // Non-competition blocks don't schedule matches → rest is irrelevant (0);
        // competition blocks override this with cfg.minRestMinutes below.
        minRestMinutes: 0,
        ...partial,
      };
      blocks.push(b);
      if (neededMin > 0) {
        const allocated = timeToMin(partial.endTime) - timeToMin(partial.startTime);
        if (allocated < neededMin) {
          const overflow = Math.ceil(neededMin - allocated);
          warnings.push({
            blockId: b.id,
            message: `Needs ${overflow} more minutes`,
            suggestedEndTime: minToTime(timeToMin(partial.startTime) + Math.ceil(neededMin)),
            overflowMinutes: overflow,
          });
        }
      }
    };

    const advance = (min: number): void => {
      cursor += min;
      if (cursor >= dayEndMin) {
        dayIndex++;
        cursor = timeToMin(cfg.dayStartTime);
        middayInserted = false;
      }
    };

    const maybeInsertMidday = (): void => {
      if (!middayInserted && cursor >= middayStartMin) {
        const duration = middayEndMin - middayStartMin;
        const end = Math.min(cursor + duration, dayEndMin);
        push({
          dayIndex,
          blockType: 'break',
          label: 'Lunch Break',
          competitionId: null,
          competitionPhase: null,
          workshopId: null,
          liceCount: 0,
          startTime: minToTime(cursor),
          endTime: minToTime(end),
          matchGapSeconds: 0,
          matchDurationMinutes: 0,
        });
        cursor = end;
        middayInserted = true;
      }
    };

    // Admin blocks (day 1 only)
    const regMin = cfg.registrationDurationMinutes + cfg.gearCheckDurationMinutes;
    push({
      dayIndex: 0,
      blockType: 'admin',
      label: 'Registration & Gear Check',
      competitionId: null,
      competitionPhase: null,
      workshopId: null,
      liceCount: 0,
      startTime: minToTime(cursor),
      endTime: minToTime(cursor + regMin),
      matchGapSeconds: 0,
      matchDurationMinutes: 0,
    });
    advance(regMin);

    push({
      dayIndex: 0,
      blockType: 'admin',
      label: 'Referee Meeting',
      competitionId: null,
      competitionPhase: null,
      workshopId: null,
      liceCount: 0,
      startTime: minToTime(cursor),
      endTime: minToTime(cursor + cfg.refereeMeetingDurationMinutes),
      matchGapSeconds: 0,
      matchDurationMinutes: 0,
    });
    advance(cfg.refereeMeetingDurationMinutes);

    // Pool sessions
    for (const t of tournamentStats) {
      if (t.poolMatchCount === 0) continue;
      maybeInsertMidday();
      // Pools run strict one-per-lice, so wall-clock = the busiest lice, not
      // ceil(total / lices). liceCount reflects the lices actually occupied.
      const { minutes: neededMin, licesUsed } = poolBottleneckMinutes(
        t.poolPerPoolCounts,
        parallelLice,
        cfg.poolMatchDurationMinutes,
        cfg.matchGapSeconds,
      );
      const alloc = Math.min(Math.ceil(neededMin), dayEndMin - cursor);
      push(
        {
          dayIndex,
          blockType: 'competition',
          label: `${t.name} — Pools`,
          competitionId: t.id,
          competitionPhase: 'pool',
          workshopId: null,
          liceCount: Math.max(1, licesUsed),
          startTime: minToTime(cursor),
          endTime: minToTime(cursor + alloc),
          matchGapSeconds: cfg.matchGapSeconds,
          matchDurationMinutes: cfg.poolMatchDurationMinutes,
          minRestMinutes: cfg.minRestMinutes,
        },
        neededMin,
      );
      advance(Math.ceil(neededMin));
      // Break after pool
      push({
        dayIndex,
        blockType: 'break',
        label: 'Break',
        competitionId: null,
        competitionPhase: null,
        workshopId: null,
        liceCount: 0,
        startTime: minToTime(cursor),
        endTime: minToTime(cursor + cfg.breakBetweenSessionsMinutes),
        matchGapSeconds: 0,
        matchDurationMinutes: 0,
      });
      advance(cfg.breakBetweenSessionsMinutes);
    }

    // Bracket sessions — elimination rounds run at the elimination duration;
    // the final round (gold + bronze) is carved into its own Finals block at
    // the finals duration so it can be scheduled at its longer clock length.
    const pushBracketBlock = (
      t: (typeof tournamentStats)[number],
      matchCount: number,
      durationMin: number,
      phase: 'bracket' | 'finals',
      labelSuffix: string,
    ): void => {
      if (matchCount === 0) return;
      maybeInsertMidday();
      const neededMin = computeNeededMin(
        matchCount,
        parallelLice,
        durationMin,
        cfg.matchGapSeconds,
      );
      const alloc = Math.min(Math.ceil(neededMin), dayEndMin - cursor);
      push(
        {
          dayIndex,
          blockType: 'competition',
          label: `${t.name} — ${labelSuffix}`,
          competitionId: t.id,
          competitionPhase: phase,
          workshopId: null,
          liceCount: parallelLice,
          startTime: minToTime(cursor),
          endTime: minToTime(cursor + alloc),
          matchGapSeconds: cfg.matchGapSeconds,
          matchDurationMinutes: durationMin,
          minRestMinutes: cfg.minRestMinutes,
        },
        neededMin,
      );
      advance(Math.ceil(neededMin));
    };

    // Swiss sessions — one block per tournament, reserving the WHOLE phase up
    // front (decision 7). Rounds are placed into it as they are paired.
    for (const t of tournamentStats) {
      if (t.swissMatchCount === 0) continue;
      maybeInsertMidday();
      const neededMin = computeNeededMin(
        t.swissMatchCount,
        parallelLice,
        swissDurationMin,
        cfg.matchGapSeconds,
      );
      const alloc = Math.min(Math.ceil(neededMin), dayEndMin - cursor);
      push(
        {
          dayIndex,
          blockType: 'competition',
          label: `${t.name} — Swiss`,
          competitionId: t.id,
          competitionPhase: 'swiss',
          workshopId: null,
          // A Swiss round spreads ACROSS pistes (no pool affinity), so the
          // block claims every parallel lice rather than one per group.
          liceCount: parallelLice,
          startTime: minToTime(cursor),
          endTime: minToTime(cursor + alloc),
          matchGapSeconds: cfg.matchGapSeconds,
          matchDurationMinutes: swissDurationMin,
          minRestMinutes: cfg.minRestMinutes,
        },
        neededMin,
      );
      advance(Math.ceil(neededMin));
      push({
        dayIndex,
        blockType: 'break',
        label: 'Break',
        competitionId: null,
        competitionPhase: null,
        workshopId: null,
        liceCount: 0,
        startTime: minToTime(cursor),
        endTime: minToTime(cursor + cfg.breakBetweenSessionsMinutes),
        matchGapSeconds: 0,
        matchDurationMinutes: 0,
      });
      advance(cfg.breakBetweenSessionsMinutes);
    }

    for (const t of tournamentStats) {
      if (t.bracketMatchCount === 0) continue;
      const eliminationMatchCount = t.bracketMatchCount - t.finalsMatchCount;
      pushBracketBlock(
        t,
        eliminationMatchCount,
        cfg.eliminationMatchDurationMinutes,
        'bracket',
        'Bracket',
      );
      pushBracketBlock(t, t.finalsMatchCount, cfg.finalsMatchDurationMinutes, 'finals', 'Finals');
    }

    return { blocks, warnings };
  }

  // ── Generate ───────────────────────────────────────────────────────────────

  async generate(eventId: string, opts?: { dayIndices?: number[] }): Promise<GenerateResult> {
    // When dayIndices is provided, only (re)generate those days — other
    // days' blocks/matches are left untouched.
    const dayFilter =
      opts?.dayIndices && opts.dayIndices.length > 0 ? new Set(opts.dayIndices) : null;
    const { data: blocksData, error: blocksErr } = await this.supabase.service
      .from('event_programme_blocks')
      .select('*')
      .eq('event_id', eventId)
      .order('day_index', { ascending: true })
      .order('sort_order', { ascending: true });
    if (blocksErr) throw new BadRequestException(blocksErr.message);

    const { data: eventData } = await this.supabase.service
      .from('events')
      .select('start_date')
      .eq('id', eventId)
      .single();
    if (!eventData) throw new NotFoundException('Event not found');

    const startDate = new Date((eventData as Record<string, string>)['start_date'] ?? '');

    const { data: licesData } = await this.supabase.service
      .from('lices')
      .select('id, name, sort_order, venue_id')
      .eq('event_id', eventId)
      .order('sort_order', { ascending: true });
    const allLices = (licesData ?? []) as Array<{
      id: string;
      name: string;
      sort_order: number | null;
      venue_id: string | null;
    }>;

    // Fail loud when the event has any competition block but no lices
    // configured. Without this the per-block loop below silently
    // `continue`s and the operator sees a green "Generated 0 matches"
    // banner with no clue why the grid stays empty.
    const hasCompetitionBlock = (blocksData ?? []).some(
      (b) => (b as Record<string, unknown>)['block_type'] === 'competition',
    );
    if (hasCompetitionBlock && allLices.length === 0) {
      throw new BadRequestException(
        'Event has no lices configured. Add at least one lice in Event setup before generating the grid.',
      );
    }

    // Per-phase venue assignment (multi-venue tournaments): a pool block lands on
    // its tournament's Pools venue, a bracket/finals block on its Bracket venue.
    // Keyed `${tournamentId}:${pool|bracket}` → venue_id; finals run with the
    // bracket (no separate finals slot). Empty map ⇒ legacy single-venue behavior.
    const phaseVenueByKey = new Map<string, string>();
    const competitionTournamentIds = [
      ...new Set(
        (blocksData ?? [])
          .filter(
            (b) =>
              (b as Record<string, unknown>)['block_type'] === 'competition' &&
              (b as Record<string, unknown>)['competition_id'],
          )
          .map((b) => String((b as Record<string, unknown>)['competition_id'])),
      ),
    ];
    if (competitionTournamentIds.length > 0) {
      const { data: phaseVenueRows } = await this.supabase.service
        .from('tournament_phase_venues')
        .select('tournament_id, phase_kind, venue_id')
        .in('tournament_id', competitionTournamentIds);
      for (const r of (phaseVenueRows ?? []) as Array<{
        tournament_id: string;
        phase_kind: string;
        venue_id: string | null;
      }>) {
        if (r.venue_id) phaseVenueByKey.set(`${r.tournament_id}:${r.phase_kind}`, r.venue_id);
      }
    }

    // Tournaments that have a dedicated `finals` competition block. Only for
    // these does a `bracket` block hand its final round off to the finals block;
    // a legacy programme with a lone `bracket` block (pre per-phase durations)
    // keeps every bracket match so the final round is still scheduled, not
    // orphaned. Freshly-suggested programmes always have both blocks.
    const tournamentsWithFinalsBlock = new Set(
      (blocksData ?? [])
        .filter(
          (b) =>
            (b as Record<string, unknown>)['block_type'] === 'competition' &&
            (b as Record<string, unknown>)['competition_phase'] === 'finals' &&
            (b as Record<string, unknown>)['competition_id'],
        )
        .map((b) => String((b as Record<string, unknown>)['competition_id'])),
    );

    let matchesScheduled = 0;
    // Workshops are no longer scheduled by the programme generator (own board).
    const workshopSessionsCreated = 0;
    const warnings: Array<{
      blockId: string;
      message: string;
      suggestedEndTime: string;
      overflowMinutes: number;
    }> = [];
    const blockDiagnostics: BlockDiagnostic[] = [];
    // Sequential, no-overlap pack: sweep each day's blocks in (day, sort_order)
    // order with a running cursor (minutes-of-day). Every block starts no
    // earlier than the previous one ends, so competition runs land after the
    // admin/break blocks above them and any block below a long run cascades
    // later. Blocks only ever move later, never earlier; operator gaps
    // (storedStart > cursor) are preserved. Competition durations come from the
    // realized schedule, so the cursor reflects how long pools actually run.
    const cursorByDay: Record<number, number> = {};

    for (const rawBlock of blocksData ?? []) {
      const block = this.mapBlock(rawBlock as Record<string, unknown>);
      if (dayFilter && !dayFilter.has(block.dayIndex)) continue;

      const storedStartMin = timeToMin(block.startTime);
      const storedDurationMin = Math.max(0, timeToMin(block.endTime) - storedStartMin);
      const prevEnd = cursorByDay[block.dayIndex];
      const effStartMin = prevEnd == null ? storedStartMin : Math.max(storedStartMin, prevEnd);
      const allocatedEndMin = effStartMin + storedDurationMin;

      if (block.blockType === 'competition' && block.competitionId) {
        const dayDate = new Date(startDate);
        dayDate.setDate(dayDate.getDate() + block.dayIndex);

        // Anchor the run at the swept start (not the stored start) so it begins
        // after whatever precedes it on the day. blockEndDt is the allocated
        // window (stored duration shifted to the swept start) — only used for
        // the advisory overflow warning; the real end is the realized one.
        const blockStartDt = new Date(dayDate);
        blockStartDt.setHours(Math.floor(effStartMin / 60), effStartMin % 60, 0, 0);
        const blockEndDt = new Date(dayDate);
        blockEndDt.setHours(Math.floor(allocatedEndMin / 60), allocatedEndMin % 60, 0, 0);

        const matches = await this.fetchCompetitionMatches(
          block.competitionId,
          block.competitionPhase,
          {
            splitFinals: tournamentsWithFinalsBlock.has(block.competitionId),
          },
        );
        // Restrict this block's lices to its phase's assigned venue, if any
        // (pool block → Pools venue; swiss block → Swiss venue;
        // bracket/finals block → Bracket venue).
        const phaseKind =
          block.competitionPhase === 'pool'
            ? 'pool'
            : block.competitionPhase === 'swiss'
              ? 'swiss'
              : 'bracket';
        const phaseVenueId = phaseVenueByKey.get(`${block.competitionId}:${phaseKind}`) ?? null;
        const candidateLices = phaseVenueId
          ? allLices.filter((l) => l.venue_id === phaseVenueId)
          : allLices;
        const blockLices = candidateLices.slice(0, block.liceCount);
        if (matches.length === 0) {
          // Most often: the operator added a Pools block before
          // running the pool draw, so the `matches` table has no rows
          // for this tournament yet. Surface it explicitly so they
          // know which block to fix.
          warnings.push({
            blockId: block.id,
            message: `No matches to schedule for "${block.label}" — has the draw been run?`,
            suggestedEndTime: block.endTime,
            overflowMinutes: 0,
          });
          blockDiagnostics.push({
            blockId: block.id,
            blockLabel: block.label,
            blockType: block.blockType,
            fetchedMatches: 0,
            scheduledMatches: 0,
            licesAvailable: blockLices.length,
          });
          // Empty block (no draw yet): place nothing, but keep its nominal
          // slot so later blocks don't slide up over where the operator put it.
          cursorByDay[block.dayIndex] = allocatedEndMin;
          continue;
        }
        if (blockLices.length === 0) {
          // block.liceCount is 0 even though the event does have lices
          // — invalid block, but logged so the operator sees it.
          blockDiagnostics.push({
            blockId: block.id,
            blockLabel: block.label,
            blockType: block.blockType,
            fetchedMatches: matches.length,
            scheduledMatches: 0,
            licesAvailable: 0,
          });
          cursorByDay[block.dayIndex] = allocatedEndMin;
          continue;
        }

        const poolAffinity = decidePoolAffinity({
          isPool: block.competitionPhase === 'pool',
          matches,
        });
        const result = scheduleMatches(
          matches.map((m) => ({
            id: m.id,
            redRegistrationId: m.red_registration_id,
            blueRegistrationId: m.blue_registration_id,
            poolId: m.pool_id,
            poolSortOrder: m.pool_sort_order,
            matchNumberLabel: m.match_number_label,
            bracketRound: m.bracket_round,
            bracketPosition: m.bracket_position,
          })),
          blockLices.map((l) => ({ id: l.id, name: l.name, sortOrder: l.sort_order })),
          {
            startTime: blockStartDt.toISOString(),
            defaultMatchDurationMinutes: block.matchDurationMinutes,
            transitionMinutes: block.matchGapSeconds / 60,
            minRestMinutes: block.minRestMinutes,
            // Pools stay on one lice; single-elim brackets use branch-aware
            // grouping; anything else is greedy.
            poolAffinity,
          },
        );

        if (result.scheduledMatches.length > 0) {
          const lastEnd =
            result.scheduledMatches[result.scheduledMatches.length - 1]?.estimatedEndAt;
          if (lastEnd && new Date(lastEnd) > blockEndDt) {
            const overflowMin = Math.ceil(
              (new Date(lastEnd).getTime() - blockEndDt.getTime()) / 60000,
            );
            warnings.push({
              blockId: block.id,
              message: `Schedule overflows by ${overflowMin} minutes`,
              suggestedEndTime: minToTime(allocatedEndMin + overflowMin),
              overflowMinutes: overflowMin,
            });
          }
        }

        // Bulk UPSERT in one round-trip (was a sequential for-loop of
        // N UPDATEs). We always carry phase_id because PostgREST emits
        // `INSERT … ON CONFLICT DO UPDATE` and PostgreSQL validates
        // the candidate INSERT row's NOT NULL constraints BEFORE the
        // conflict resolver fires — `matches.phase_id` is NOT NULL, so
        // omitting it crashes the round-trip even for rows that exist.
        const phaseByMatchId = new Map(matches.map((m) => [m.id, m.phase_id]));
        const matchesPayload = result.scheduledMatches.map((sm) => ({
          id: sm.matchId,
          phase_id: phaseByMatchId.get(sm.matchId),
          scheduled_at: sm.scheduledAt,
          lice_id: sm.liceId,
        }));
        const { data: upserted, error: matchesErr } = await this.supabase.service
          .from('matches')
          .upsert(matchesPayload, { onConflict: 'id' })
          .select('id');
        if (matchesErr) {
          throw new BadRequestException(
            `Failed to schedule matches for block "${block.label}": ${matchesErr.message}`,
          );
        }
        const persistedCount = (upserted ?? []).length;
        matchesScheduled += persistedCount;

        // Realized-window sync: the scheduler may run a phase far longer than
        // the planner's estimate (strict pools serialize on one lice). Rewrite
        // the competition block's start_time (the swept start) + end_time +
        // lice_count from what actually landed so the sidebar mirrors the grid,
        // and advance the day cursor so the next block packs after this run.
        if (result.scheduledMatches.length > 0) {
          const startMsList = result.scheduledMatches.map((sm) =>
            new Date(sm.scheduledAt).getTime(),
          );
          const endMsList = result.scheduledMatches.map((sm) =>
            new Date(sm.estimatedEndAt).getTime(),
          );
          const rawDurationMin = (Math.max(...endMsList) - Math.min(...startMsList)) / 60_000;
          // Round up to the next 30 min, matching the grid's block geometry.
          const durationMin = Math.max(30, Math.ceil(rawDurationMin / 30) * 30);
          const licesUsed = new Set(result.scheduledMatches.map((sm) => sm.liceId)).size;
          const realizedEndMin = effStartMin + durationMin;

          const { error: syncErr } = await this.supabase.service
            .from('event_programme_blocks')
            .update({
              start_time: minToTime(effStartMin),
              end_time: minToTime(realizedEndMin),
              lice_count: licesUsed,
            })
            .eq('id', block.id);
          if (syncErr) throw new BadRequestException(syncErr.message);

          cursorByDay[block.dayIndex] = realizedEndMin;
        } else {
          cursorByDay[block.dayIndex] = allocatedEndMin;
        }

        blockDiagnostics.push({
          blockId: block.id,
          blockLabel: block.label,
          blockType: block.blockType,
          fetchedMatches: matches.length,
          // Use the persisted count so diagnostics reflect what
          // actually landed in the DB, not the scheduler's intent.
          scheduledMatches: persistedCount,
          licesAvailable: blockLices.length,
        });
      } else {
        // Fixed block (admin / break / workshop, or a competition block missing
        // its tournament link). Keep its duration but slide it to the swept
        // start so it never overlaps the block above it, then advance the
        // cursor. This generalizes the old break-only shift to admin
        // (Referee Meeting) and breaks (Lunch) alike — blocks only move later.
        const effEndMin = effStartMin + storedDurationMin;
        if (effStartMin !== storedStartMin) {
          const { error: shiftErr } = await this.supabase.service
            .from('event_programme_blocks')
            .update({ start_time: minToTime(effStartMin), end_time: minToTime(effEndMin) })
            .eq('id', block.id);
          if (shiftErr) throw new BadRequestException(shiftErr.message);
        }
        cursorByDay[block.dayIndex] = effEndMin;
      }
    }

    const { error: stampErr } = await this.supabase.service
      .from('event_programme_blocks')
      .update({ generated_at: new Date().toISOString() })
      .eq('event_id', eventId);
    if (stampErr) {
      throw new BadRequestException(
        `Failed to stamp generated_at on event_programme_blocks: ${stampErr.message}`,
      );
    }

    return { matchesScheduled, workshopSessionsCreated, warnings, blockDiagnostics };
  }

  // ── Move a single fixed block (slice 5: drag in the grid) ──────────────────

  /**
   * Drag a programme block to a new start time on the same day and
   * cascade-shift every match scheduled at or after the block's old
   * start by the same Δ. Keeps the visual order of the grid intact:
   * forward drags push later matches forward; backward drags pull
   * them back. Other days are untouched.
   */
  async moveBlock(
    eventId: string,
    blockId: string,
    dto: { newStartTime: string },
  ): Promise<{
    block: ProgrammeBlock;
    deltaMinutes: number;
    shiftedMatches: number;
  }> {
    const { data: blockRow, error: blockErr } = await this.supabase.service
      .from('event_programme_blocks')
      .select('*')
      .eq('id', blockId)
      .eq('event_id', eventId)
      .single();
    if (blockErr || !blockRow) {
      throw new NotFoundException(`Block ${blockId} not found for event ${eventId}`);
    }
    const block = this.mapBlock(blockRow as Record<string, unknown>);

    const deltaMin = timeToMin(dto.newStartTime) - timeToMin(block.startTime);
    if (deltaMin === 0) {
      return { block, deltaMinutes: 0, shiftedMatches: 0 };
    }

    const newEndTime = minToTime(timeToMin(block.endTime) + deltaMin);

    // Look up the event date so we can scope cascade shifts to the
    // block's day. start_date + dayIndex → date for THIS block.
    //
    // WALL-CLOCK, not UTC. The scheduler stores matches with `setHours` (see
    // the `blockStartDt` construction in generate), i.e. container-local time
    // via `TZ` in docker-compose. This used to read them back with
    // getUTCHours/setUTCDate, so on any container that is not UTC the two
    // disagreed by the offset: a block at 09:00 local is stored as 08:00Z, and
    // `480 < 540` skipped EVERY match. The bar moved and not one match followed
    // it — silently, on every non-UTC deployment. `deleteBlock` already used
    // wall-clock math and its comment pointed here; this is that fix.
    const { data: eventData } = await this.supabase.service
      .from('events')
      .select('start_date')
      .eq('id', eventId)
      .single();
    if (!eventData) throw new NotFoundException(`Event ${eventId} not found`);

    const startDate = new Date(`${(eventData as Record<string, string>)['start_date']}T00:00:00`);
    startDate.setDate(startDate.getDate() + block.dayIndex);
    const blockDateIso = localDateIso(startDate);

    // Walk the matches we want to consider shifting: every match under
    // every phase under every tournament of this event. PostgREST
    // can't span the join in one UPDATE, so we fan out.
    const { data: tournamentsData } = await this.supabase.service
      .from('tournaments')
      .select('id')
      .eq('event_id', eventId);
    const tournamentIds = ((tournamentsData ?? []) as Array<{ id: string }>).map((t) => t.id);

    let shiftedMatches = 0;
    if (tournamentIds.length > 0) {
      const { data: phasesData } = await this.supabase.service
        .from('phases')
        .select('id')
        .in('tournament_id', tournamentIds);
      const phaseIds = ((phasesData ?? []) as Array<{ id: string }>).map((p) => p.id);

      if (phaseIds.length > 0) {
        const { data: matchesData } = await this.supabase.service
          .from('matches')
          .select('id, scheduled_at')
          .in('phase_id', phaseIds);
        const matches = (matchesData ?? []) as Array<{
          id: string;
          scheduled_at: string | null;
        }>;

        const oldStartMin = timeToMin(block.startTime);
        for (const m of matches) {
          if (!m.scheduled_at) continue;
          const matchDate = new Date(m.scheduled_at);
          // Same calendar day as the block, in WALL-CLOCK terms — the stored
          // instant's local date, not the UTC prefix of its ISO string.
          if (localDateIso(matchDate) !== blockDateIso) continue;
          // At or after the block's old startTime, read the same way.
          const matchMinOfDay = matchDate.getHours() * 60 + matchDate.getMinutes();
          if (matchMinOfDay < oldStartMin) continue;

          const shifted = new Date(matchDate.getTime() + deltaMin * 60_000);
          await this.supabase.service
            .from('matches')
            .update({ scheduled_at: shifted.toISOString() })
            .eq('id', m.id);
          shiftedMatches++;
        }
      }
    }

    // Cascade across the day's programme blocks: every block at or after the
    // moved block's OLD start shifts by the same Δ (the moved block included),
    // so later blocks stay in order behind the one that moved.
    const { data: dayBlockRows } = await this.supabase.service
      .from('event_programme_blocks')
      .select('id, start_time, end_time')
      .eq('event_id', eventId)
      .eq('day_index', block.dayIndex);
    const dayBlocks = (
      (dayBlockRows ?? []) as Array<{
        id: string;
        start_time: string;
        end_time: string;
      }>
    ).map((b) => ({
      id: b.id,
      startMin: timeToMin(trimSeconds(b.start_time)),
      endMin: timeToMin(trimSeconds(b.end_time)),
    }));
    const shifts = cascadeBlockShift(dayBlocks, blockId, deltaMin);

    let updatedBlock: ProgrammeBlock = {
      ...block,
      startTime: dto.newStartTime,
      endTime: newEndTime,
    };
    for (const s of shifts) {
      const { data: updatedRow } = await this.supabase.service
        .from('event_programme_blocks')
        .update({ start_time: minToTime(s.startMin), end_time: minToTime(s.endMin) })
        .eq('id', s.id)
        .select('*')
        .single();
      if (s.id === blockId && updatedRow) {
        updatedBlock = this.mapBlock(updatedRow as Record<string, unknown>);
      }
    }

    return { block: updatedBlock, deltaMinutes: deltaMin, shiftedMatches };
  }

  /**
   * Resize a block by setting a new end_time. Start_time stays as
   * stored — the operator dragged the bottom edge on the grid, not
   * the top. Validates newEndTime > startTime; no cascade applied,
   * the FE's place-with-shift helper handles neighbour reflow
   * client-side then PATCHes the moved matches via
   * `PATCH /matches/:id/schedule`.
   */
  async resizeBlock(
    eventId: string,
    blockId: string,
    dto: { newStartTime?: string; newEndTime?: string },
  ): Promise<{ block: ProgrammeBlock }> {
    const { data: blockRow, error: blockErr } = await this.supabase.service
      .from('event_programme_blocks')
      .select('*')
      .eq('id', blockId)
      .eq('event_id', eventId)
      .single();
    if (blockErr || !blockRow) {
      throw new NotFoundException(`Block ${blockId} not found for event ${eventId}`);
    }
    const block = this.mapBlock(blockRow as Record<string, unknown>);

    // Whichever edge wasn't dragged keeps its current value; the resulting
    // window must still be start < end.
    const nextStart = dto.newStartTime ?? block.startTime;
    const nextEnd = dto.newEndTime ?? block.endTime;
    if (timeToMin(nextEnd) <= timeToMin(nextStart)) {
      throw new BadRequestException(
        `Block "${block.label}" end (${nextEnd}) must be after start (${nextStart})`,
      );
    }

    const patch: Record<string, unknown> = {};
    if (dto.newStartTime) patch['start_time'] = dto.newStartTime;
    if (dto.newEndTime) patch['end_time'] = dto.newEndTime;
    if (Object.keys(patch).length === 0) return { block };

    const { data: updatedRow, error: updErr } = await this.supabase.service
      .from('event_programme_blocks')
      .update(patch)
      .eq('id', blockId)
      .eq('event_id', eventId)
      .select('*')
      .single();
    if (updErr) {
      throw new BadRequestException(`Failed to resize block: ${updErr.message}`);
    }
    const updatedBlock = updatedRow
      ? this.mapBlock(updatedRow as Record<string, unknown>)
      : { ...block, startTime: nextStart, endTime: nextEnd };
    return { block: updatedBlock };
  }

  /**
   * Re-fan a group of matches (a pool or a single-elim bracket sub-tree) across
   * the given lices from a start time. Branch-aware for brackets; the group is
   * seeded to land AFTER whatever already occupies those lices (no overlap).
   */
  async scheduleGroup(
    eventId: string,
    dto: ScheduleGroupDto,
  ): Promise<{
    scheduled: Array<{ matchId: string; liceId: string; scheduledAt: string }>;
    imbalancePercent: number;
    unscheduled: string[];
  }> {
    if (dto.matchIds.length === 0 || dto.liceIds.length === 0) {
      return { scheduled: [], imbalancePercent: 0, unscheduled: dto.matchIds };
    }

    const eventPhaseIds = await this.eventPhaseIds(eventId);

    const { data: matchRows, error: mErr } = await this.supabase.service
      .from('matches')
      .select(
        'id, red_registration_id, blue_registration_id, pool_id, match_number_label, phase_id, bracket_slot_id',
      )
      .in('id', dto.matchIds);
    if (mErr) throw new BadRequestException(mErr.message);
    const rows = (matchRows ?? []) as Array<{
      id: string;
      red_registration_id: string;
      blue_registration_id: string;
      pool_id: string | null;
      match_number_label: string | null;
      phase_id: string;
      bracket_slot_id: string | null;
    }>;
    if (rows.length !== dto.matchIds.length || rows.some((r) => !eventPhaseIds.has(r.phase_id))) {
      throw new BadRequestException('Some matches do not belong to this event');
    }

    // Lices in the operator's requested order (anchor i → liceIds[i]).
    const { data: liceRows } = await this.supabase.service
      .from('lices')
      .select('id, name, sort_order')
      .in('id', dto.liceIds);
    const liceById = new Map(
      ((liceRows ?? []) as Array<{ id: string; name: string; sort_order: number | null }>).map(
        (l) => [l.id, l],
      ),
    );
    const lices = dto.liceIds
      .map((id, i) => {
        const l = liceById.get(id);
        return l ? { id: l.id, name: l.name, sortOrder: i } : null;
      })
      .filter((l): l is { id: string; name: string; sortOrder: number } => l !== null);
    if (lices.length === 0) throw new BadRequestException('No valid lices to schedule onto');

    const matchDuration = dto.matchDurationMinutes ?? 5;

    // Seed each lice's first-free time from its existing occupants (excluding
    // the group) so the re-fan appends instead of overlapping them.
    const groupIds = new Set(dto.matchIds);
    const { data: occRows } = await this.supabase.service
      .from('matches')
      .select('id, lice_id, scheduled_at')
      .in('lice_id', dto.liceIds);
    const liceBusyUntil: Record<string, string> = {};
    for (const o of (occRows ?? []) as Array<{
      id: string;
      lice_id: string | null;
      scheduled_at: string | null;
    }>) {
      if (groupIds.has(o.id) || !o.lice_id || !o.scheduled_at) continue;
      const end = new Date(
        new Date(o.scheduled_at).getTime() + matchDuration * 60_000,
      ).toISOString();
      if (!liceBusyUntil[o.lice_id] || liceBusyUntil[o.lice_id]! < end) {
        liceBusyUntil[o.lice_id] = end;
      }
    }

    const bracketSlotIds = rows.map((r) => r.bracket_slot_id).filter((id): id is string => !!id);
    const coords =
      dto.mode === 'bracket-branch'
        ? await this.loadBracketCoords(bracketSlotIds)
        : new Map<string, { round: number; position: number }>();
    const shape =
      dto.mode === 'bracket-branch'
        ? await this.loadBracketShape(bracketSlotIds)
        : { wbRounds: null, lbRounds: null };

    const result = scheduleMatches(
      rows.map((r) => {
        const c = r.bracket_slot_id ? coords.get(r.bracket_slot_id) : undefined;
        return {
          id: r.id,
          redRegistrationId: r.red_registration_id,
          blueRegistrationId: r.blue_registration_id,
          poolId: dto.mode === 'pool' ? r.pool_id : null,
          matchNumberLabel: r.match_number_label,
          bracketRound: c?.round ?? null,
          bracketPosition: c?.position ?? null,
          wbRounds: shape.wbRounds,
          lbRounds: shape.lbRounds,
        };
      }),
      lices,
      {
        startTime: dto.startTime,
        defaultMatchDurationMinutes: matchDuration,
        transitionMinutes: (dto.matchGapSeconds ?? 0) / 60,
        minRestMinutes: dto.minRestMinutes ?? 10,
        poolAffinity: dto.mode === 'pool' ? 'strict' : 'bracket-branch',
        liceBusyUntil,
      },
    );

    await Promise.all(
      result.scheduledMatches.map(async (sm) => {
        const { error } = await this.supabase.service
          .from('matches')
          .update({ lice_id: sm.liceId, scheduled_at: sm.scheduledAt })
          .eq('id', sm.matchId);
        if (error) throw new BadRequestException(`Failed to schedule match: ${error.message}`);
      }),
    );

    return {
      scheduled: result.scheduledMatches.map((sm) => ({
        matchId: sm.matchId,
        liceId: sm.liceId,
        scheduledAt: sm.scheduledAt,
      })),
      imbalancePercent: result.imbalancePercent,
      unscheduled: result.unscheduled,
    };
  }

  /** Rename a single programme block (admin / break / workshop bar). */
  /**
   * Create a SINGLE programme block (the grid's "add break" + Undo-after-
   * delete paths). Appends one row at the next sort_order on its day, so it
   * lands after any existing blocks. Competition-only fields fall back to the
   * non-competition zero values when omitted.
   */
  async createBlock(eventId: string, dto: CreateBlockDto): Promise<{ block: ProgrammeBlock }> {
    // Next sort_order on the day = max existing + 1 (computed in JS — PostgREST
    // has no MAX without an RPC). Ordered desc so the first row is the highest.
    const { data: existing } = await this.supabase.service
      .from('event_programme_blocks')
      .select('sort_order')
      .eq('event_id', eventId)
      .eq('day_index', dto.dayIndex)
      .order('sort_order', { ascending: false });
    const highest = ((existing ?? [])[0] as { sort_order: number } | undefined)?.sort_order ?? -1;

    const { data, error } = await this.supabase.service
      .from('event_programme_blocks')
      .insert({
        event_id: eventId,
        day_index: dto.dayIndex,
        sort_order: highest + 1,
        block_type: dto.blockType,
        label: dto.label,
        competition_id: dto.competitionId ?? null,
        competition_phase: dto.competitionPhase ?? null,
        workshop_id: dto.workshopId ?? null,
        lice_count: dto.liceCount ?? 0,
        start_time: dto.startTime,
        end_time: dto.endTime,
        match_gap_seconds: dto.matchGapSeconds ?? 0,
        match_duration_minutes: dto.matchDurationMinutes ?? 0,
        min_rest_minutes: dto.minRestMinutes ?? 10,
        color_hex: dto.colorHex ?? null,
      })
      .select('*')
      .single();
    if (error || !data)
      throw new BadRequestException(error?.message ?? 'Failed to create programme block');
    return { block: this.mapBlock(data as Record<string, unknown>) };
  }

  async updateBlockLabel(
    eventId: string,
    blockId: string,
    dto: UpdateBlockLabelDto,
  ): Promise<{ block: ProgrammeBlock }> {
    // Label is required; color is optional — only patch what was sent.
    const patch: Record<string, unknown> = { label: dto.label };
    if (dto.colorHex !== undefined) patch['color_hex'] = dto.colorHex;
    const { data: updatedRow, error } = await this.supabase.service
      .from('event_programme_blocks')
      .update(patch)
      .eq('id', blockId)
      .eq('event_id', eventId)
      .select('*')
      .single();
    if (error || !updatedRow) {
      throw new NotFoundException(`Block ${blockId} not found for event ${eventId}`);
    }
    return { block: this.mapBlock(updatedRow as Record<string, unknown>) };
  }

  /** Phase ids belonging to this event's tournaments (scope guard). */
  private async eventPhaseIds(eventId: string): Promise<Set<string>> {
    const { data: tournaments } = await this.supabase.service
      .from('tournaments')
      .select('id')
      .eq('event_id', eventId);
    const tournamentIds = ((tournaments ?? []) as Array<{ id: string }>).map((t) => t.id);
    if (tournamentIds.length === 0) return new Set();
    const { data: phases } = await this.supabase.service
      .from('phases')
      .select('id')
      .in('tournament_id', tournamentIds);
    return new Set(((phases ?? []) as Array<{ id: string }>).map((p) => p.id));
  }

  /**
   * Delete a single programme block. Matches scheduled INSIDE the
   * block's time window on the same day are unscheduled
   * (scheduled_at + lice_id → null) so they reappear in the
   * Unscheduled sidebar — operator decides what to do next.
   * Matches OUTSIDE the window are left in place; operator runs
   * Generate Grid for a full reflow.
   *
   * Uses wall-clock (`setHours`/`setDate`) date math matching the
   * scheduler — both must agree on what timezone "10:00" means so the
   * [start, end) window catches exactly the matches the scheduler placed
   * inside the block. `moveBlock` now does the same; it used to use UTC math,
   * which silently shifted NOTHING on a non-UTC container.
   */
  async deleteBlock(
    eventId: string,
    blockId: string,
  ): Promise<{ deletedId: string; unscheduledMatchIds: string[] }> {
    // 1. Load the block (event-scoped guard rejects cross-event ids).
    const { data: blockRow, error: blockErr } = await this.supabase.service
      .from('event_programme_blocks')
      .select('id, event_id, day_index, start_time, end_time')
      .eq('id', blockId)
      .eq('event_id', eventId)
      .maybeSingle();
    if (blockErr) throw new BadRequestException(`Failed to load block: ${blockErr.message}`);
    if (!blockRow) throw new NotFoundException(`Block ${blockId} not found for event ${eventId}`);

    // 2. Compute [startIso, endIso) for the block's day. Must match
    //    the scheduler's wall-clock interpretation (programme.service
    //    lines 517-520 use `setHours`/`setDate` — i.e. container-local
    //    TZ via `TZ=${TZ}` in docker-compose). Mismatching this with
    //    setUTCHours would leave matches stored at "10:00 local" =
    //    "08:00 UTC" outside an [09:30 UTC, 10:00 UTC) window, but
    //    *also* match an unrelated set of matches at 09:30 UTC =
    //    11:30 local — the delete then unschedules the wrong day.
    const { data: eventData, error: evErr } = await this.supabase.service
      .from('events')
      .select('start_date')
      .eq('id', eventId)
      .single();
    if (evErr) throw new BadRequestException(`Failed to load event: ${evErr.message}`);
    if (!eventData) throw new NotFoundException(`Event ${eventId} not found`);

    const dayDate = new Date(`${(eventData as Record<string, string>)['start_date']}T00:00:00`);
    dayDate.setDate(dayDate.getDate() + (blockRow.day_index as number));
    const [sh, sm] = (blockRow.start_time as string).split(':').map(Number);
    const [eh, em] = (blockRow.end_time as string).split(':').map(Number);
    const startIso = new Date(dayDate);
    startIso.setHours(sh ?? 0, sm ?? 0, 0, 0);
    const endIso = new Date(dayDate);
    endIso.setHours(eh ?? 0, em ?? 0, 0, 0);

    // 3. Unschedule matches whose scheduled_at falls inside the window.
    //    Scope through tournaments → phases of THIS event so the update
    //    can't touch other events. matches.scheduled_at + lice_id → null
    //    pushes them back to the Unscheduled sidebar.
    const { data: tournamentsData, error: tErr } = await this.supabase.service
      .from('tournaments')
      .select('id')
      .eq('event_id', eventId);
    if (tErr) throw new BadRequestException(tErr.message);
    const tournamentIds = ((tournamentsData ?? []) as Array<{ id: string }>).map((t) => t.id);

    let unscheduledMatchIds: string[] = [];
    if (tournamentIds.length > 0) {
      const { data: phasesData, error: phErr } = await this.supabase.service
        .from('phases')
        .select('id')
        .in('tournament_id', tournamentIds);
      if (phErr) throw new BadRequestException(phErr.message);
      const phaseIds = ((phasesData ?? []) as Array<{ id: string }>).map((p) => p.id);

      if (phaseIds.length > 0) {
        const { data: updated, error: matchErr } = await this.supabase.service
          .from('matches')
          .update({ scheduled_at: null, lice_id: null })
          .in('phase_id', phaseIds)
          .gte('scheduled_at', startIso.toISOString())
          .lt('scheduled_at', endIso.toISOString())
          .select('id');
        if (matchErr)
          throw new BadRequestException(
            `Failed to unschedule matches in block window: ${matchErr.message}`,
          );
        unscheduledMatchIds = ((updated ?? []) as Array<{ id: string }>).map((r) => r.id);
      }
    }

    // 4. Delete the block row last — a matches-update failure above
    //    throws before we touch the block, so partial state isn't
    //    possible.
    const { error: delErr } = await this.supabase.service
      .from('event_programme_blocks')
      .delete()
      .eq('id', blockId)
      .eq('event_id', eventId);
    if (delErr) throw new BadRequestException(`Failed to delete block: ${delErr.message}`);

    return { deletedId: blockId, unscheduledMatchIds };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async fetchCompetitionMatches(
    tournamentId: string,
    phase: string | null,
    opts?: { splitFinals?: boolean },
  ): Promise<
    Array<{
      id: string;
      red_registration_id: string;
      blue_registration_id: string;
      pool_id: string | null;
      pool_sort_order: number | null;
      match_number_label: string | null;
      phase_id: string;
      phase_type: string | null;
      bracket_round: number | null;
      bracket_position: number | null;
    }>
  > {
    if (phase === 'pool') {
      const { data: phasesData } = await this.supabase.service
        .from('phases')
        .select('id, type')
        .eq('tournament_id', tournamentId);
      const phases = (phasesData ?? []) as Array<{ id: string; type: string }>;
      const poolPhaseIds = phases.filter((p) => p.type === 'pool').map((p) => p.id);
      if (poolPhaseIds.length === 0) return [];

      // Pool sort_order joins back to the scheduler so pool i lands on
      // lice i (operator's mental model). Without it the allocator
      // wraps modulo at lice index 0 for every pool — the
      // load-balancing fallback.
      const { data: poolsData } = await this.supabase.service
        .from('pools')
        .select('id, sort_order')
        .in('phase_id', poolPhaseIds);
      const pools = (poolsData ?? []) as Array<{ id: string; sort_order: number | null }>;
      const poolIds = pools.map((p) => p.id);
      if (poolIds.length === 0) return [];
      const poolSortOrder = new Map<string, number | null>(pools.map((p) => [p.id, p.sort_order]));

      const { data: matchesData } = await this.supabase.service
        .from('matches')
        .select(
          'id, red_registration_id, blue_registration_id, pool_id, match_number_label, phase_id',
        )
        .in('pool_id', poolIds)
        .order('pool_id', { ascending: true })
        .order('match_number_label', { ascending: true });
      const rows = (matchesData ?? []) as Array<{
        id: string;
        red_registration_id: string;
        blue_registration_id: string;
        pool_id: string | null;
        match_number_label: string | null;
        phase_id: string;
      }>;
      return rows.map((r) => ({
        ...r,
        pool_sort_order: r.pool_id ? (poolSortOrder.get(r.pool_id) ?? null) : null,
        phase_type: 'pool',
        bracket_round: null,
        bracket_position: null,
      }));
    } else if (phase === 'swiss') {
      return this.loadSwissMatches(tournamentId);
    } else {
      // Partition the bracket by final round so a 'bracket' block schedules the
      // elimination rounds and a 'finals' block schedules only the final round
      // (gold + bronze) — same classification the estimate used, so the two
      // blocks never fetch the same match twice.
      const { rows, finalRound } = await this.loadBracketMatches(tournamentId);
      if (phase === 'finals') {
        return finalRound == null ? [] : rows.filter((r) => r.bracket_round === finalRound);
      }
      // 'bracket' (elimination): exclude the final round ONLY when a sibling
      // finals block will schedule it (opts.splitFinals). Without one — a legacy
      // programme with a lone bracket block, or no resolvable round — keep every
      // match so the final round is scheduled here rather than orphaned.
      if (!opts?.splitFinals || finalRound == null) return rows;
      return rows.filter((r) => r.bracket_round !== finalRound);
    }
  }

  /**
   * Bouts the whole Swiss phase will produce: `roundCount × ⌈activeEntrants/2⌉`,
   * summed over the tournament's Swiss phases.
   *
   * Read from the phase CONFIG and the entrant roster, not from `matches`.
   * Only the current round exists at any moment — decision 3 pairs the next
   * one on completion — so counting rows would size the block for round 1 and
   * strand every round after it.
   *
   * A withdrawn entrant still occupies the estimate: the field is frozen at
   * generation, and over-reserving a few minutes is the safe direction.
   */
  private async estimateSwissMatchCount(
    swissPhases: Array<{ id: string; config_json?: unknown }>,
  ): Promise<number> {
    if (swissPhases.length === 0) return 0;

    const { data: entrantRows } = await this.supabase.service
      .from('swiss_entrants')
      .select('phase_id')
      .in(
        'phase_id',
        swissPhases.map((p) => p.id),
      );
    const entrantsByPhase = new Map<string, number>();
    for (const row of (entrantRows ?? []) as Array<{ phase_id: string }>) {
      entrantsByPhase.set(row.phase_id, (entrantsByPhase.get(row.phase_id) ?? 0) + 1);
    }

    let total = 0;
    for (const phase of swissPhases) {
      const entrants = entrantsByPhase.get(phase.id) ?? 0;
      if (entrants < 2) continue;
      const roundCount = parseSwissConfig(phase.config_json)?.roundCount ?? 0;
      if (roundCount < 1) continue;
      // An odd field gives one bye per round, so ⌊n/2⌋ bouts — but ⌈n/2⌉ is
      // what the block must hold when the field is even.
      total += roundCount * Math.floor(entrants / 2);
    }
    return total;
  }

  /**
   * Every Swiss match for a tournament, ordered by round then label.
   *
   * `bracket_round` / `bracket_position` stay null: a Swiss phase has no tree,
   * so `decidePoolAffinity` reads `hasTree === false` and returns `'off'`
   * (greedy). That is the right allocation — a Swiss round spreads ACROSS
   * pistes rather than being pinned to one, unlike a pool.
   */
  private async loadSwissMatches(tournamentId: string): Promise<BracketMatchRow[]> {
    const { data: phasesData } = await this.supabase.service
      .from('phases')
      .select('id, type')
      .eq('tournament_id', tournamentId);
    const swissPhaseIds = ((phasesData ?? []) as Array<{ id: string; type: string }>)
      .filter((p) => p.type === 'swiss')
      .map((p) => p.id);
    if (swissPhaseIds.length === 0) return [];

    const { data: matchesData } = await this.supabase.service
      .from('matches')
      .select(
        'id, red_registration_id, blue_registration_id, pool_id, match_number_label, phase_id, swiss_round_id, swiss_rounds(round_number)',
      )
      .in('phase_id', swissPhaseIds)
      .order('match_number_label', { ascending: true });

    const raw = (matchesData ?? []) as unknown as Array<{
      id: string;
      red_registration_id: string;
      blue_registration_id: string;
      pool_id: string | null;
      match_number_label: string | null;
      phase_id: string;
      swiss_rounds: { round_number: number } | Array<{ round_number: number }> | null;
    }>;
    const roundOf = (row: (typeof raw)[number]): number => {
      const rel = Array.isArray(row.swiss_rounds) ? row.swiss_rounds[0] : row.swiss_rounds;
      return rel?.round_number ?? 0;
    };

    return raw
      .slice()
      .sort((a, b) => roundOf(a) - roundOf(b))
      .map((r) => ({
        id: r.id,
        red_registration_id: r.red_registration_id,
        blue_registration_id: r.blue_registration_id,
        pool_id: r.pool_id,
        pool_sort_order: null,
        match_number_label: r.match_number_label,
        phase_id: r.phase_id,
        phase_type: 'swiss',
        bracket_round: null,
        bracket_position: null,
      }));
  }

  /** Slot id → {round, position} for bracket matches. Empty input = no query. */
  private async loadBracketCoords(
    slotIds: string[],
  ): Promise<Map<string, { round: number; position: number }>> {
    const map = new Map<string, { round: number; position: number }>();
    const ids = [...new Set(slotIds)];
    if (ids.length === 0) return map;
    const { data } = await this.supabase.service
      .from('bracket_slots')
      .select('id, round, position')
      .in('id', ids);
    for (const s of (data ?? []) as Array<{ id: string; round: number; position: number }>) {
      map.set(s.id, { round: s.round, position: s.position });
    }
    return map;
  }

  /**
   * The double-elim round split for the phase these slots belong to, so branch
   * grouping spreads only the winners bracket. Null/null for single-elim (and
   * for any phase whose config predates the split being recorded), which keeps
   * the single-elim grouping byte-identical.
   */
  private async loadBracketShape(
    slotIds: string[],
  ): Promise<{ wbRounds: number | null; lbRounds: number | null }> {
    const none = { wbRounds: null, lbRounds: null };
    const ids = [...new Set(slotIds)];
    if (ids.length === 0) return none;
    const { data: slots } = await this.supabase.service
      .from('bracket_slots')
      .select('phase_id')
      .in('id', ids)
      .limit(1);
    const phaseId = (slots ?? [])[0]?.['phase_id'] as string | undefined;
    if (!phaseId) return none;
    const { data: phase } = await this.supabase.service
      .from('phases')
      .select('type, config_json')
      .eq('id', phaseId)
      .maybeSingle();
    const row = phase as { type?: string; config_json?: Record<string, unknown> } | null;
    if (row?.type !== 'double_elim') return none;
    const cfg = row.config_json ?? {};
    const num = (v: unknown) => (typeof v === 'number' ? v : null);
    return { wbRounds: num(cfg['wbRounds']), lbRounds: num(cfg['lbRounds']) };
  }

  /**
   * Load every non-pool (bracket) match for a tournament with its bracket
   * round resolved, plus the tournament's `finalRound` = the highest round
   * present. A match is a "finals" match (gold final + bronze, or the
   * double-elim grand final / reset) iff `bracket_round === finalRound`;
   * everything else — including matches with no resolvable round — is an
   * "elimination" match. Single source of truth so the block-time estimate
   * (`buildSuggestion`) and the block→match routing (`fetchCompetitionMatches`)
   * classify finals identically and never double-schedule. `finalRound` is
   * null when no rounds resolve, which disables the finals split entirely.
   */
  private async loadBracketMatches(tournamentId: string): Promise<{
    rows: BracketMatchRow[];
    finalRound: number | null;
  }> {
    const { data: phasesData } = await this.supabase.service
      .from('phases')
      .select('id, type')
      .eq('tournament_id', tournamentId);
    const phases = (phasesData ?? []) as Array<{ id: string; type: string }>;
    // The two ELIM types only. This used to be `type !== 'pool'`, which swept
    // a Swiss phase's matches into the Bracket block: they have no
    // bracket_slot_id, so they never matched finalRound and were re-fetched
    // by every bracket block.
    const bracketPhases = phases.filter(
      (p) => p.type === 'single_elim' || p.type === 'double_elim',
    );
    const bracketPhaseIds = bracketPhases.map((p) => p.id);
    if (bracketPhaseIds.length === 0) return { rows: [], finalRound: null };
    const phaseTypeById = new Map(bracketPhases.map((p) => [p.id, p.type]));

    const { data: matchesData } = await this.supabase.service
      .from('matches')
      .select(
        'id, red_registration_id, blue_registration_id, pool_id, match_number_label, phase_id, bracket_slot_id',
      )
      .in('phase_id', bracketPhaseIds)
      .order('match_number_label', { ascending: true });
    const raw = (matchesData ?? []) as Array<{
      id: string;
      red_registration_id: string;
      blue_registration_id: string;
      pool_id: string | null;
      match_number_label: string | null;
      phase_id: string;
      bracket_slot_id: string | null;
    }>;
    // Join bracket_slots so the scheduler can keep each QF sub-tree on one
    // lice (branch-aware) and so the final round is identifiable.
    const coords = await this.loadBracketCoords(
      raw.map((r) => r.bracket_slot_id).filter((id): id is string => !!id),
    );
    const rows: BracketMatchRow[] = raw.map((r) => {
      const c = r.bracket_slot_id ? coords.get(r.bracket_slot_id) : undefined;
      return {
        id: r.id,
        red_registration_id: r.red_registration_id,
        blue_registration_id: r.blue_registration_id,
        pool_id: r.pool_id,
        pool_sort_order: null,
        match_number_label: r.match_number_label,
        phase_id: r.phase_id,
        phase_type: phaseTypeById.get(r.phase_id) ?? null,
        bracket_round: c?.round ?? null,
        bracket_position: c?.position ?? null,
      };
    });
    const rounds = rows.map((r) => r.bracket_round).filter((r): r is number => r != null);
    const finalRound = rounds.length > 0 ? Math.max(...rounds) : null;
    return { rows, finalRound };
  }

  private validateBlocks(blocks: SaveProgrammeDto['blocks']): void {
    for (const block of blocks) {
      if (timeToMin(block.endTime) <= timeToMin(block.startTime)) {
        throw new BadRequestException(`Block "${block.label}" must end after it starts`);
      }

      if (block.blockType !== 'competition') continue;

      if (!block.competitionId) {
        throw new BadRequestException(`Competition block "${block.label}" requires a tournament`);
      }
      if (!block.competitionPhase) {
        throw new BadRequestException(`Competition block "${block.label}" requires a phase`);
      }
      if (!['pool', 'swiss', 'bracket', 'finals'].includes(block.competitionPhase)) {
        throw new BadRequestException(`Competition block "${block.label}" has an invalid phase`);
      }
      if (block.liceCount < 1) {
        throw new BadRequestException(
          `Competition block "${block.label}" requires at least one lice`,
        );
      }
      if (block.matchDurationMinutes < 1) {
        throw new BadRequestException(
          `Competition block "${block.label}" requires a match duration of at least 1 minute`,
        );
      }
    }
  }

  private mapBlock(raw: Record<string, unknown>): ProgrammeBlock {
    return {
      id: raw['id'] as string,
      eventId: raw['event_id'] as string,
      dayIndex: raw['day_index'] as number,
      sortOrder: raw['sort_order'] as number,
      blockType: raw['block_type'] as ProgrammeBlock['blockType'],
      label: raw['label'] as string,
      competitionId: (raw['competition_id'] as string | null) ?? null,
      competitionPhase: (raw['competition_phase'] as ProgrammeBlock['competitionPhase']) ?? null,
      workshopId: (raw['workshop_id'] as string | null) ?? null,
      liceCount: raw['lice_count'] as number,
      startTime: trimSeconds(raw['start_time'] as string),
      endTime: trimSeconds(raw['end_time'] as string),
      matchGapSeconds: raw['match_gap_seconds'] as number,
      matchDurationMinutes: raw['match_duration_minutes'] as number,
      minRestMinutes: raw['min_rest_minutes'] as number,
      colorHex: (raw['color_hex'] as string | null) ?? null,
      generatedAt: (raw['generated_at'] as string | null) ?? null,
    };
  }
}
