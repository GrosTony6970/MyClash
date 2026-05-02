/**
 * pool-populator.controller.ts — T-904
 *
 * POST /events/:eventId/populate-pools?dryRun=true|false
 *
 * Runs pool generation with current settings.
 * dryRun=true  → returns proposal without persisting
 * dryRun=false → persists and returns same shape
 *
 * Reuses PhasesService.generatePools() for persistence.
 * Cost report: per-pool same-club count, skill variance, constraint violations.
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  snakeSeed,
  localSearch,
  buildCostReport,
  bergerSchedule,
  type Fighter,
} from '@myclash/rulesets/dist/scheduling/index';
import { SupabaseService } from '../supabase/supabase.service';
import { SettingsService } from '../referees/settings.service';
import { HemaRatingsService } from '../hema-ratings/hema-ratings.service';
import { PhasesService } from './phases.service';
import type { GeneratePoolsDto } from './dto/phases.dto';

@ApiTags('phases')
@Controller()
export class PoolPopulatorController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly settings: SettingsService,
    private readonly phases: PhasesService,
    private readonly hemaRatings: HemaRatingsService,
  ) {}

  @Post('events/:eventId/populate-pools')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate pool assignment proposal (dry-run or persist)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'dryRun', required: false, type: Boolean })
  async populatePools(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: GeneratePoolsDto,
    @Query('dryRun') dryRunParam?: string,
  ) {
    const dryRun = dryRunParam !== 'false';

    // Get tournament for this event (first active tournament)
    const { data: tournaments } = await this.supabase.service
      .from('tournaments')
      .select('id, weapon')
      .eq('event_id', eventId)
      .limit(1);

    const tournament = (tournaments as Array<{ id: string; weapon: string | null }> | null)?.[0];
    const tournamentId = tournament?.id;

    // Load settings (with tournament override if available)
    const poolSettings = await this.settings.getSettings(eventId, tournamentId);

    // Fetch registrations
    const { data: regs } = await this.supabase.service
      .from('registrations')
      .select('id, seed, bib_number, persons(club_id), fighters(hema_ratings_id)')
      .eq('tournament_id', tournamentId ?? '')
      .in('status', ['registered', 'checked_in']);

    const regList = (regs ?? []) as Array<Record<string, unknown>>;
    const fighterCount = regList.length;

    if (fighterCount < 2) {
      return { error: 'Need at least 2 registered fighters', fighterCount };
    }

    // Resolve pool count
    let poolCount: number;
    if (dto.poolCount !== undefined) {
      poolCount = dto.poolCount;
    } else {
      const targetSize = dto.targetSize ?? 8;
      poolCount = Math.max(1, Math.ceil(fighterCount / targetSize));
    }

    const hemaIds = Array.from(
      new Set(
        regList
          .map((reg) => {
            const fighter = reg['fighters'] as { hema_ratings_id: string | null } | null;
            return fighter?.hema_ratings_id ?? null;
          })
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const weightedRatings = await this.hemaRatings.resolveWeightedRatings(
      hemaIds,
      tournament?.weapon,
    );

    // Map to Fighter type
    const fighters: Fighter[] = regList.map((reg, idx) => {
      const person = reg['persons'] as { club_id: string | null } | null;
      const fighter = reg['fighters'] as { hema_ratings_id: string | null } | null;
      const hemaRatingsId = fighter?.hema_ratings_id ?? null;
      return {
        registrationId: reg['id'] as string,
        clubId: person?.club_id ?? null,
        skillRating: hemaRatingsId ? (weightedRatings.get(hemaRatingsId) ?? null) : null,
        seed: (reg['seed'] as number | null) ?? (reg['bib_number'] as number | null) ?? idx + 1,
      };
    });

    const strictness: 'soft' | 'strict' =
      poolSettings.schoolSeparationStrictness === 'hard' ? 'strict' : 'soft';
    const assignmentSettings = {
      enforceSchoolSeparation: poolSettings.enforceSchoolSeparation,
      schoolSeparationStrictness: strictness,
      enforceSkillBalance: poolSettings.enforceSkillBalance,
    };

    // Run algorithm
    const initial = snakeSeed(fighters, poolCount);
    const optimized = localSearch(
      initial,
      fighters,
      poolCount,
      assignmentSettings,
      undefined,
      dto.seed ?? 42,
    );
    const costReport = buildCostReport(optimized, fighters, poolCount, assignmentSettings);

    // Build pool preview
    const poolMap = new Map<number, typeof fighters>();
    for (const a of optimized) {
      const existing = poolMap.get(a.poolIndex) ?? [];
      existing.push(fighters.find((f) => f.registrationId === a.registrationId)!);
      poolMap.set(a.poolIndex, existing);
    }

    const pools = Array.from({ length: poolCount }, (_, i) => ({
      poolIndex: i,
      name: `Pool ${String.fromCharCode(65 + i)}`,
      fighters: poolMap.get(i) ?? [],
      matchCount: bergerSchedule((poolMap.get(i) ?? []).length).length,
    }));

    // Constraint violations summary
    const violations: string[] = [];
    const totalSameClubPairs = costReport.sameClubPairsPerPool.reduce((s, p) => s + p.count, 0);
    if (totalSameClubPairs > 0) {
      violations.push(`${totalSameClubPairs} same-club pairs in same pool`);
    }

    const proposal = {
      dryRun,
      poolCount,
      fighterCount,
      pools,
      costReport,
      violations,
      settings: {
        enforceSchoolSeparation: poolSettings.enforceSchoolSeparation,
        enforceSkillBalance: poolSettings.enforceSkillBalance,
        enforceFighterRefereeNoOverlap: true, // always
      },
    };

    if (dryRun) {
      return proposal;
    }

    // Persist via PhasesService
    if (!tournamentId) {
      return { error: 'No tournament found for this event' };
    }

    const result = await this.phases.generatePools(tournamentId, dto, true);
    return { ...proposal, ...result, dryRun: false };
  }
}
