/**
 * auto-assign.controller.ts — T-905
 *
 * POST /events/:eventId/auto-assign-referees?dryRun=true|false
 * POST /events/:eventId/lock-referee-assignments
 */

import {
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
  assignRefereesWithPools,
  type RefereeCandidate,
  type RefereePoolSlot,
} from '@myclash/rulesets/dist/scheduling/index';
import { SupabaseService } from '../supabase/supabase.service';
import { SettingsService } from './settings.service';

@ApiTags('referees')
@Controller()
export class AutoAssignController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly settings: SettingsService,
  ) {}

  // ── Auto-assign ───────────────────────────────────────────────────────────────

  @Post('events/:eventId/auto-assign-referees')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Auto-assign referees to pools (dry-run or persist)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'dryRun', required: false, type: Boolean })
  async autoAssign(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query('dryRun') dryRunParam?: string,
  ) {
    const dryRun = dryRunParam !== 'false';

    // Load settings
    const poolSettings = await this.settings.getSettings(eventId);

    // Fetch pools + matches for this event's tournaments
    const { data: pools } = await this.supabase.service
      .from('pools')
      .select(
        `
        id, name,
        matches (
          id, match_number_label, scheduled_at,
          red_registration_id, blue_registration_id
        ),
        phases ( tournament_id )
      `,
      )
      .eq('phases.event_id', eventId);

    const poolSlots: RefereePoolSlot[] = (pools ?? []).map((p) => {
      const row = p as Record<string, unknown>;
      const matches = (row['matches'] as Array<Record<string, unknown>>) ?? [];

      const scheduledTimes = matches
        .map((m) => m['scheduled_at'] as string | null)
        .filter(Boolean) as string[];

      return {
        poolId: row['id'] as string,
        poolName: row['name'] as string,
        matches: matches.map((m) => ({
          id: m['id'] as string,
          scheduledAt: (m['scheduled_at'] as string | null) ?? null,
          durationMinutes: 5,
          redRegistrationId: m['red_registration_id'] as string,
          blueRegistrationId: m['blue_registration_id'] as string,
        })),
        earliestStart: scheduledTimes.length > 0 ? scheduledTimes.sort()[0]! : null,
        latestEnd:
          scheduledTimes.length > 0
            ? new Date(
                new Date(scheduledTimes.sort().reverse()[0]!).getTime() + 5 * 60_000,
              ).toISOString()
            : null,
      };
    });

    // Fetch referee candidates (persons with active qualifications)
    const { data: qualRows } = await this.supabase.service
      .from('referee_qualifications')
      .select('person_id, role, rating, persons ( id, given_name, family_name )')
      .eq('event_id', eventId)
      .eq('active', true);

    // Group qualifications by person
    const personQuals = new Map<
      string,
      { name: string; quals: Array<{ role: string; rating: number | null }> }
    >();
    for (const q of qualRows ?? []) {
      const row = q as Record<string, unknown>;
      const person = row['persons'] as {
        id: string;
        given_name: string;
        family_name: string;
      } | null;
      if (!person) continue;

      const existing = personQuals.get(person.id) ?? {
        name: `${person.given_name} ${person.family_name}`,
        quals: [],
      };
      existing.quals.push({
        role: row['role'] as string,
        rating: (row['rating'] as number | null) ?? null,
      });
      personQuals.set(person.id, existing);
    }

    // Fetch fighter registrations for each person
    const { data: regRows } = await this.supabase.service
      .from('registrations')
      .select('id, person_id')
      .in('status', ['registered', 'checked_in']);

    const personFighterRegs = new Map<string, string[]>();
    for (const r of regRows ?? []) {
      const row = r as { id: string; person_id: string };
      const existing = personFighterRegs.get(row.person_id) ?? [];
      existing.push(row.id);
      personFighterRegs.set(row.person_id, existing);
    }

    // Build candidates
    const candidates: RefereeCandidate[] = Array.from(personQuals.entries()).map(
      ([personId, { name, quals }]) => ({
        personId,
        personName: name,
        qualifications: quals as Array<{
          role: 'arbitre_declarant' | 'arbitre_assesseur' | 'arbitre_table';
          rating: number | null;
        }>,
        fighterRegistrationIds: personFighterRegs.get(personId) ?? [],
        workshopWindows: [], // T-802 workshops not yet wired here
      }),
    );

    // Run engine
    const result = assignRefereesWithPools(poolSlots, candidates, {
      enforceRefereeNoBackToBack: poolSettings.enforceRefereeNoBackToBack,
      refereeRestMinSlots: poolSettings.refereeRestMinSlots,
      enforceDedicatedRefereeRest: poolSettings.enforceDedicatedRefereeRest,
      workshopConflictWarning: poolSettings.workshopConflictWarning,
      ratingBasedOrdering: poolSettings.ratingBasedOrdering,
      workloadBalance: poolSettings.workloadBalance,
    });

    if (dryRun) {
      return { dryRun: true, ...result };
    }

    // Persist assignments
    if (result.assignments.length > 0) {
      // Delete existing auto-assigned rows
      await this.supabase.service
        .from('referee_assignments')
        .delete()
        .eq('event_id', eventId)
        .eq('auto_assigned', true);

      // Insert new assignments
      await this.supabase.service.from('referee_assignments').insert(
        result.assignments.map((a) => ({
          event_id: eventId,
          pool_id: a.poolId,
          person_id: a.personId,
          role: a.role,
          auto_assigned: true,
          status: 'assigned',
          conflicts_jsonb: result.warnings
            .filter((w) => w.personId === a.personId && w.poolId === a.poolId)
            .map((w) => ({ type: w.type, detail: w.detail })),
        })),
      );
    }

    return { dryRun: false, ...result, persisted: result.assignments.length };
  }

  // ── Lock assignments ──────────────────────────────────────────────────────────

  @Post('events/:eventId/lock-referee-assignments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lock referee assignments (transition to confirmed)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async lockAssignments(@Param('eventId', ParseUUIDPipe) eventId: string) {
    const { data } = await this.supabase.service
      .from('referee_assignments')
      .update({ status: 'confirmed' })
      .eq('event_id', eventId)
      .eq('status', 'assigned')
      .select('id');

    const count = (data as Array<{ id: string }> | null)?.length ?? 0;

    // TODO T-1201: trigger notifications to confirmed referees

    return { confirmed: count, notificationsSent: false };
  }
}
