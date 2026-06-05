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
import type { SaveProgrammeDto, SuggestProgrammeDto } from './dto/programme.dto';

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
 * Normalise the `HH:MM:SS[.sss]` strings PostgREST returns for `TIME`
 * columns down to the `HH:MM` form the DTO regex (and the FE
 * `<input type="time">`) expects. Pass-through for already-trimmed
 * values; defensive against null / undefined inputs.
 */
function trimSeconds(raw: string | null | undefined): string {
  if (!raw) return '';
  return /^\d{2}:\d{2}:/.test(raw) ? raw.slice(0, 5) : raw;
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
      matchDurationMinutes: dto.matchDurationMinutes,
      matchGapSeconds: dto.matchGapSeconds,
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
      bracketMatchCount: number;
    }
    const tournamentStats: TournamentStats[] = [];

    for (const t of tournaments) {
      const { data: phasesData } = await this.supabase.service
        .from('phases')
        .select('id, type')
        .eq('tournament_id', t.id);
      const phases = (phasesData ?? []) as Array<{ id: string; type: string }>;

      const poolPhaseIds = phases.filter((p) => p.type === 'pool').map((p) => p.id);
      const bracketPhaseIds = phases.filter((p) => p.type !== 'pool').map((p) => p.id);

      let poolMatchCount = 0;
      if (poolPhaseIds.length > 0) {
        const { data: poolsData } = await this.supabase.service
          .from('pools')
          .select('id')
          .in('phase_id', poolPhaseIds);
        const poolIds = (poolsData ?? []).map((p) => (p as Record<string, string>)['id']);
        if (poolIds.length > 0) {
          const { count } = await this.supabase.service
            .from('matches')
            .select('id', { count: 'exact', head: true })
            .in('pool_id', poolIds);
          poolMatchCount = count ?? 0;
        }
      }

      let bracketMatchCount = 0;
      if (bracketPhaseIds.length > 0) {
        const { count } = await this.supabase.service
          .from('matches')
          .select('id', { count: 'exact', head: true })
          .in('phase_id', bracketPhaseIds);
        bracketMatchCount = count ?? 0;
      }

      tournamentStats.push({ id: t.id, name: t.name, poolMatchCount, bracketMatchCount });
    }

    // Load workshops with duration
    const { data: workshopsData } = await this.supabase.service
      .from('workshops')
      .select('id, title, duration_minutes')
      .eq('event_id', eventId);
    const workshops = (workshopsData ?? []) as Array<{
      id: string;
      title: string;
      duration_minutes: number | null;
    }>;

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
      partial: Omit<ProgrammeBlock, 'id' | 'eventId' | 'sortOrder' | 'generatedAt'>,
      neededMin = 0,
    ): void => {
      const b: ProgrammeBlock = {
        id: `new-${sortOrder}`,
        eventId,
        sortOrder: sortOrder++,
        generatedAt: null,
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
      const neededMin = computeNeededMin(
        t.poolMatchCount,
        parallelLice,
        cfg.matchDurationMinutes,
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
          liceCount: parallelLice,
          startTime: minToTime(cursor),
          endTime: minToTime(cursor + alloc),
          matchGapSeconds: cfg.matchGapSeconds,
          matchDurationMinutes: cfg.matchDurationMinutes,
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

    // Bracket sessions
    for (const t of tournamentStats) {
      if (t.bracketMatchCount === 0) continue;
      maybeInsertMidday();
      const neededMin = computeNeededMin(
        t.bracketMatchCount,
        parallelLice,
        cfg.matchDurationMinutes,
        cfg.matchGapSeconds,
      );
      const alloc = Math.min(Math.ceil(neededMin), dayEndMin - cursor);
      push(
        {
          dayIndex,
          blockType: 'competition',
          label: `${t.name} — Bracket`,
          competitionId: t.id,
          competitionPhase: 'bracket',
          workshopId: null,
          liceCount: parallelLice,
          startTime: minToTime(cursor),
          endTime: minToTime(cursor + alloc),
          matchGapSeconds: cfg.matchGapSeconds,
          matchDurationMinutes: cfg.matchDurationMinutes,
        },
        neededMin,
      );
      advance(Math.ceil(neededMin));
    }

    // Workshops
    for (const w of workshops) {
      const durationMin = w.duration_minutes ?? 60;
      maybeInsertMidday();
      push({
        dayIndex,
        blockType: 'workshop',
        label: w.title ?? 'Workshop',
        competitionId: null,
        competitionPhase: null,
        workshopId: w.id,
        liceCount: 0,
        startTime: minToTime(cursor),
        endTime: minToTime(cursor + durationMin),
        matchGapSeconds: 0,
        matchDurationMinutes: 0,
      });
      advance(durationMin);
    }

    return { blocks, warnings };
  }

  // ── Generate ───────────────────────────────────────────────────────────────

  async generate(eventId: string): Promise<GenerateResult> {
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
      .select('id, name')
      .eq('event_id', eventId)
      .order('sort_order', { ascending: true });
    const allLices = (licesData ?? []) as Array<{ id: string; name: string }>;

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

    let matchesScheduled = 0;
    let workshopSessionsCreated = 0;
    const warnings: Array<{
      blockId: string;
      message: string;
      suggestedEndTime: string;
      overflowMinutes: number;
    }> = [];
    const blockDiagnostics: BlockDiagnostic[] = [];

    for (const rawBlock of blocksData ?? []) {
      const block = this.mapBlock(rawBlock as Record<string, unknown>);

      if (block.blockType === 'competition' && block.competitionId) {
        const dayDate = new Date(startDate);
        dayDate.setDate(dayDate.getDate() + block.dayIndex);

        const [sh, sm] = block.startTime.split(':').map(Number);
        const [eh, em] = block.endTime.split(':').map(Number);

        const blockStartDt = new Date(dayDate);
        blockStartDt.setHours(sh ?? 0, sm ?? 0, 0, 0);
        const blockEndDt = new Date(dayDate);
        blockEndDt.setHours(eh ?? 0, em ?? 0, 0, 0);

        const matches = await this.fetchCompetitionMatches(
          block.competitionId,
          block.competitionPhase,
        );
        const blockLices = allLices.slice(0, block.liceCount);
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
          continue;
        }

        const result = scheduleMatches(
          matches.map((m) => ({
            id: m.id,
            redRegistrationId: m.red_registration_id,
            blueRegistrationId: m.blue_registration_id,
            poolId: m.pool_id,
          })),
          blockLices,
          {
            startTime: blockStartDt.toISOString(),
            defaultMatchDurationMinutes: block.matchDurationMinutes,
            transitionMinutes: block.matchGapSeconds / 60,
            // Pool phase: keep every match of a pool on the same Lice.
            // Bracket / finals phases: per-match greedy (no shared pool).
            poolAffinity: block.competitionPhase === 'pool' ? 'strict' : 'off',
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
              suggestedEndTime: minToTime(timeToMin(block.endTime) + overflowMin),
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
      }

      if (block.blockType === 'workshop' && block.workshopId) {
        const dayDate = new Date(startDate);
        dayDate.setDate(dayDate.getDate() + block.dayIndex);

        const [sh, sm] = block.startTime.split(':').map(Number);
        const [eh, em] = block.endTime.split(':').map(Number);

        const startsAt = new Date(dayDate);
        startsAt.setHours(sh ?? 0, sm ?? 0, 0, 0);
        const endsAt = new Date(dayDate);
        endsAt.setHours(eh ?? 0, em ?? 0, 0, 0);

        const { error: wsErr } = await this.supabase.service.from('workshop_sessions').upsert(
          {
            workshop_id: block.workshopId,
            starts_at: startsAt.toISOString(),
            ends_at: endsAt.toISOString(),
          },
          { onConflict: 'workshop_id' },
        );
        if (wsErr) {
          throw new BadRequestException(
            `Failed to create workshop session for workshop ${block.workshopId}: ${wsErr.message}`,
          );
        }
        workshopSessionsCreated++;
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
    const { data: eventData } = await this.supabase.service
      .from('events')
      .select('start_date')
      .eq('id', eventId)
      .single();
    if (!eventData) throw new NotFoundException(`Event ${eventId} not found`);

    const startDate = new Date(
      `${(eventData as Record<string, string>)['start_date']}T00:00:00.000Z`,
    );
    startDate.setUTCDate(startDate.getUTCDate() + block.dayIndex);
    const blockDateIso = startDate.toISOString().slice(0, 10);

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
          // Same calendar day as the block?
          if (m.scheduled_at.slice(0, 10) !== blockDateIso) continue;
          // At or after the block's old startTime?
          const matchDate = new Date(m.scheduled_at);
          const matchMinOfDay = matchDate.getUTCHours() * 60 + matchDate.getUTCMinutes();
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

    // Persist the block's new times.
    const { data: updatedRow } = await this.supabase.service
      .from('event_programme_blocks')
      .update({ start_time: dto.newStartTime, end_time: newEndTime })
      .eq('id', blockId)
      .select('*')
      .single();
    const updatedBlock = updatedRow
      ? this.mapBlock(updatedRow as Record<string, unknown>)
      : { ...block, startTime: dto.newStartTime, endTime: newEndTime };

    return { block: updatedBlock, deltaMinutes: deltaMin, shiftedMatches };
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
   * scheduler at lines 517-520 — both must agree on what timezone
   * "10:00" means so the [start, end) window catches exactly the
   * matches the scheduler placed inside the block. (moveBlock still
   * uses UTC math; same fix should be applied there if its cascade
   * shifts the wrong matches on a non-UTC container.)
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
  ): Promise<
    Array<{
      id: string;
      red_registration_id: string;
      blue_registration_id: string;
      pool_id: string | null;
      phase_id: string;
    }>
  > {
    const { data: phasesData } = await this.supabase.service
      .from('phases')
      .select('id, type')
      .eq('tournament_id', tournamentId);
    const phases = (phasesData ?? []) as Array<{ id: string; type: string }>;

    if (phase === 'pool') {
      const poolPhaseIds = phases.filter((p) => p.type === 'pool').map((p) => p.id);
      if (poolPhaseIds.length === 0) return [];

      const { data: poolsData } = await this.supabase.service
        .from('pools')
        .select('id')
        .in('phase_id', poolPhaseIds);
      const poolIds = (poolsData ?? []).map((p) => (p as Record<string, string>)['id']);
      if (poolIds.length === 0) return [];

      const { data: matchesData } = await this.supabase.service
        .from('matches')
        .select('id, red_registration_id, blue_registration_id, pool_id, phase_id')
        .in('pool_id', poolIds)
        .order('pool_id', { ascending: true })
        .order('match_number_label', { ascending: true });
      return (matchesData ?? []) as Array<{
        id: string;
        red_registration_id: string;
        blue_registration_id: string;
        pool_id: string | null;
        phase_id: string;
      }>;
    } else {
      const bracketPhaseIds = phases.filter((p) => p.type !== 'pool').map((p) => p.id);
      if (bracketPhaseIds.length === 0) return [];

      const { data: matchesData } = await this.supabase.service
        .from('matches')
        .select('id, red_registration_id, blue_registration_id, pool_id, phase_id')
        .in('phase_id', bracketPhaseIds)
        .order('match_number_label', { ascending: true });
      return (matchesData ?? []) as Array<{
        id: string;
        red_registration_id: string;
        blue_registration_id: string;
        pool_id: string | null;
        phase_id: string;
      }>;
    }
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
      if (!['pool', 'bracket', 'finals'].includes(block.competitionPhase)) {
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
      generatedAt: (raw['generated_at'] as string | null) ?? null,
    };
  }
}
