import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DEFAULT_TOURNAMENT_LOCK_CONFIG, type TournamentLockConfig } from '@myclash/types';
import { SupabaseService } from '../supabase/supabase.service';
import { MatchesService } from './matches.service';

type Row = Record<string, unknown>;

@Injectable()
export class MatchAutoLockService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MatchAutoLockService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly matches: MatchesService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.runOnce(), 60_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(now = new Date()): Promise<number> {
    const tournamentsResult = await this.supabase.service
      .from('tournaments')
      .select('id, lock_config_json');
    if (tournamentsResult.error) {
      this.logger.warn(`Auto-lock scan failed: ${tournamentsResult.error.message}`);
      return 0;
    }

    const phasesResult = await this.supabase.service
      .from('phases')
      .select('id, tournament_id, type');
    if (phasesResult.error) {
      this.logger.warn(`Auto-lock scan failed: ${phasesResult.error.message}`);
      return 0;
    }

    const matchesResult = await this.supabase.service
      .from('matches')
      .select('id, phase_id, status, ended_at, locked_at, pool_id');
    if (matchesResult.error) {
      this.logger.warn(`Auto-lock scan failed: ${matchesResult.error.message}`);
      return 0;
    }

    const phasesByTournament = this.groupBy(this.rows(phasesResult.data), 'tournament_id');
    const matchesByPhase = this.groupBy(this.rows(matchesResult.data), 'phase_id');

    let locked = 0;
    for (const tournament of this.rows(tournamentsResult.data)) {
      const config = this.config(tournament['lock_config_json']);
      if (!config.autoLockEnabled) continue;
      for (const phase of phasesByTournament.get(String(tournament['id'])) ?? []) {
        const phaseType = String(phase['type'] ?? '');
        if (phaseType === 'pool' && !config.autoLockCompletedPools) continue;
        if (phaseType !== 'pool' && !config.autoLockCompletedBrackets) continue;
        locked += await this.lockEligiblePhaseMatches(
          phase,
          matchesByPhase.get(String(phase['id'])) ?? [],
          config,
          now,
        );
      }
    }
    return locked;
  }

  private async lockEligiblePhaseMatches(
    phase: Row,
    matches: Row[],
    config: TournamentLockConfig,
    now: Date,
  ): Promise<number> {
    const groups = new Map<string, Row[]>();
    for (const match of matches) {
      const key = phase['type'] === 'pool' ? String(match['pool_id'] ?? 'no-pool') : 'bracket';
      groups.set(key, [...(groups.get(key) ?? []), match]);
    }

    let locked = 0;
    for (const group of groups.values()) {
      if (group.length === 0) continue;
      if (!group.every((match) => ['completed', 'voided'].includes(String(match['status'])))) {
        continue;
      }
      if (!this.delayElapsed(group, config.autoLockDelayMinutes, now)) continue;
      for (const match of group) {
        if (match['locked_at']) continue;
        await this.matches.lockMatch(
          String(match['id']),
          'Auto lock after completed group',
          undefined,
          'auto',
        );
        locked += 1;
      }
    }
    return locked;
  }

  private delayElapsed(matches: Row[], delayMinutes: number, now: Date): boolean {
    const latestEndedAt = Math.max(
      ...matches.map((match) => new Date(String(match['ended_at'] ?? 0)).getTime()),
    );
    if (!Number.isFinite(latestEndedAt) || latestEndedAt <= 0) return false;
    return now.getTime() - latestEndedAt >= delayMinutes * 60_000;
  }

  private config(input: unknown): TournamentLockConfig {
    const raw = input && typeof input === 'object' ? (input as Partial<TournamentLockConfig>) : {};
    return { ...DEFAULT_TOURNAMENT_LOCK_CONFIG, ...raw };
  }

  private rows(value: unknown): Row[] {
    if (!value) return [];
    return Array.isArray(value) ? (value as Row[]) : [value as Row];
  }

  private groupBy(rows: Row[], key: string): Map<string, Row[]> {
    const groups = new Map<string, Row[]>();
    for (const row of rows) {
      const groupKey = String(row[key] ?? '');
      if (!groupKey) continue;
      groups.set(groupKey, [...(groups.get(groupKey) ?? []), row]);
    }
    return groups;
  }
}
