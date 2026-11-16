import { BeforeApplicationShutdown, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { DEFAULT_TOURNAMENT_LOCK_CONFIG, type TournamentLockConfig } from '@myclash/types';
import { SupabaseService } from '../supabase/supabase.service';
import { MatchesService } from './matches.service';

type Row = Record<string, unknown>;

/** How long a stop waits for the scan in flight, counted from the stop. */
export const AUTO_LOCK_STOP_WAIT_MS = 30_000;

@Injectable()
export class MatchAutoLockService implements OnModuleDestroy, BeforeApplicationShutdown {
  private readonly logger = new Logger(MatchAutoLockService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<number> | null = null;
  private scanStartedAt = 0;
  /** The module is closing: the scan in flight stops before its next lock. */
  private closing = false;
  private stopBy = 0;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly matches: MatchesService,
  ) {}

  /**
   * Starts the scan, every 60 s. The worker process alone calls it (workers/worker-role.ts,
   * ruling 809): every process that builds this module used to start its own timer, so the api
   * and the worker both scanned and both wrote.
   */
  start(): void {
    this.timer = setInterval(() => this.tick(), 60_000);
    this.logger.log('Auto-lock scan every 60 s');
  }

  /**
   * One scan at a time (ruling 831): the first scan after a deploy can lock a backlog for longer
   * than the 60 s tick, and a second scan beside it would read and write the same groups. The
   * promise kept is the caught one: a failed scan is a warning, never a rejection, so whoever
   * waits for it cannot fail. A skipped tick says so: a scan held by a call that does not answer
   * (fetch gives up after ~300 s) must not hide.
   */
  private tick(): void {
    if (this.inFlight) {
      const seconds = Math.round((Date.now() - this.scanStartedAt) / 1000);
      this.logger.warn(`Auto-lock scan still running after ${seconds} s: this tick is skipped`);
      return;
    }
    this.scanStartedAt = Date.now();
    this.inFlight = this.runOnce()
      .catch((err: unknown) => {
        this.logger.warn(`Auto-lock scan failed: ${err instanceof Error ? err.message : err}`);
        return 0;
      })
      .finally(() => {
        this.inFlight = null;
      });
  }

  /**
   * A stop: no new scan, and the scan in flight ends at its next lock (`closing`). It does not wait
   * here: Nest destroys modules one at a time, the global BullModule last, and a wait here would
   * hold every queue Worker open, taking new jobs. The wait is in `beforeApplicationShutdown`,
   * which Nest runs after every module is destroyed, the Workers' drain included.
   */
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.closing = true;
    this.stopBy = Date.now() + AUTO_LOCK_STOP_WAIT_MS;
  }

  /**
   * A stop waits for the scan in flight (ruling 831), at most until 30 s after the stop began: it
   * ends after the lock in progress, and one lock has no time limit of its own. So the stop costs
   * the longer of the Workers' drain and this wait, never their sum.
   */
  async beforeApplicationShutdown(): Promise<void> {
    if (!this.inFlight) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<'deadline'>((done) => {
      timer = setTimeout(() => done('deadline'), Math.max(0, this.stopBy - Date.now()));
    });
    const ended = await Promise.race([this.inFlight, deadline]);
    clearTimeout(timer);
    if (ended === 'deadline') {
      this.logger.warn('Auto-lock lock still running 30 s after the stop: the stop goes on');
    }
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
      .select('id, phase_id, status, ended_at, updated_at, locked_at, pool_id');
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
        // A Bracket is one group of many bouts: a stop waits for one lock, not the whole phase.
        if (this.closing) return locked;
        if (match['locked_at']) continue;
        // Null: the Match changed since this scan read it, and the write left it alone.
        const row = await this.matches.lockMatch(
          String(match['id']),
          'Auto lock after completed group',
          String(match['updated_at']),
        );
        if (row) locked += 1;
      }
    }
    return locked;
  }

  /**
   * The wait counts from the later of each bout's end and its last write (operator,
   * 2026-10-16): a result a tablet sent an hour late ended at the time of its hit, and the desk
   * still gets the whole wait from its arrival. A correction made later starts the wait again.
   */
  private delayElapsed(matches: Row[], delayMinutes: number, now: Date): boolean {
    const latest = Math.max(
      ...matches.map((match) =>
        Math.max(
          new Date(String(match['ended_at'] ?? 0)).getTime(),
          new Date(String(match['updated_at'] ?? 0)).getTime(),
        ),
      ),
    );
    if (!Number.isFinite(latest) || latest <= 0) return false;
    return now.getTime() - latest >= delayMinutes * 60_000;
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
