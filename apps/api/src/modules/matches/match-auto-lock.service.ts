import { BeforeApplicationShutdown, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { DEFAULT_TOURNAMENT_LOCK_CONFIG, type TournamentLockConfig } from '@myclash/types';
import { isOver } from '../../common/live-status';
import { inListChunks, READ_PAGE } from '../../common/postgrest-in-list';
import { readEveryRowById, type PageAnswer } from '../../common/read-every-row-by-id';
import { SupabaseService } from '../supabase/supabase.service';
import { MatchesService } from './matches.service';

type Row = Record<string, unknown>;

/** The slice of a PostgREST read the scan's pages use. */
type PageQuery = PromiseLike<PageAnswer<Row>> & {
  eq(column: string, value: unknown): PageQuery;
  in(column: string, values: readonly unknown[]): PageQuery;
  is(column: string, value: null): PageQuery;
  gt(column: string, value: string): PageQuery;
  order(column: string): PageQuery;
  limit(count: number): PageQuery;
};

/** A phase whose bouts may lock, with its Tournament's lock settings. */
interface ScanPhase {
  id: string;
  pool: boolean;
  config: TournamentLockConfig;
}

/** Bouts locked together, or not at all: one Pool, or a whole phase that has no Pools. */
interface Group {
  key: string;
  phase: ScanPhase;
  poolId: string | null;
}

const FINISHED = ['completed', 'voided'];

const groupKey = (phase: ScanPhase, poolId: string | null): string =>
  phase.pool ? `${phase.id}/${poolId ?? 'no-pool'}` : phase.id;

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

  /**
   * One scan. It reads only what can lock, every row of it (ruling 831), then locks each finished
   * group whose wait is over. A module that closes ends the scan: every later page is skipped and
   * no further lock is made (`closing`, checked before each), so rows a stop cut short never lock.
   * What is left waits for the next start. A read PostgREST refuses throws; `tick` logs it.
   */
  async runOnce(now = new Date()): Promise<number> {
    const groups = await this.readCandidateGroups(await this.readPhases());
    const bouts = await this.readGroupBouts(groups);
    let locked = 0;
    for (const group of groups.values()) {
      const inGroup = bouts.get(group.key) ?? [];
      locked += await this.lockIfDone(inGroup, group.phase.config, now);
    }
    return locked;
  }

  /**
   * The phases whose bouts may lock: of the Tournaments that lock on their own, in the Events that
   * are not over (ruling 841: an over Event's results are frozen, a super admin's edit there is not
   * locked again). The Events' status is read, not filtered in the query: `isOver` is its one owner.
   */
  private async readPhases(): Promise<Map<string, ScanPhase>> {
    const events = await this.paged(() => this.db.from('events').select('id, status'));
    const live = events.filter((event) => !isOver(event['status'])).map((event) => event['id']);
    const tournaments = await this.pagedIn(live, (ids) =>
      this.db.from('tournaments').select('id, lock_config_json, event_id').in('event_id', ids),
    );
    const configs = new Map<string, TournamentLockConfig>();
    for (const tournament of tournaments) {
      const config = this.config(tournament['lock_config_json']);
      if (config.autoLockEnabled) configs.set(String(tournament['id']), config);
    }
    const phases = await this.pagedIn([...configs.keys()], (ids) =>
      this.db.from('phases').select('id, tournament_id, type').in('tournament_id', ids),
    );
    const kept = new Map<string, ScanPhase>();
    for (const phase of phases) {
      const config = configs.get(String(phase['tournament_id']));
      const pool = phase['type'] === 'pool';
      if (!config || !(pool ? config.autoLockCompletedPools : config.autoLockCompletedBrackets)) {
        continue;
      }
      kept.set(String(phase['id']), { id: String(phase['id']), pool, config });
    }
    return kept;
  }

  /**
   * The groups that can lock: those holding a finished bout not yet locked. A Pool is a group, and
   * so are a pool phase's bouts with no Pool; any other phase (Bracket, Swiss…) is ONE group, whatever
   * pool id its bouts carry.
   */
  private async readCandidateGroups(phases: Map<string, ScanPhase>): Promise<Map<string, Group>> {
    const candidates = await this.pagedIn([...phases.keys()], (ids) =>
      this.db
        .from('matches')
        .select('id, phase_id, pool_id')
        .in('phase_id', ids)
        .is('locked_at', null)
        .in('status', FINISHED),
    );
    const groups = new Map<string, Group>();
    for (const bout of candidates) {
      const phase = phases.get(String(bout['phase_id']));
      if (!phase) continue;
      const poolId = phase.pool ? ((bout['pool_id'] as string | null) ?? null) : null;
      const key = groupKey(phase, poolId);
      groups.set(key, { key, phase, poolId });
    }
    return groups;
  }

  /**
   * Every bout of each candidate group, locked ones too: a locked bout can run again, and its last
   * write counts in the wait. A Pool is read within its phase, so a pool id never joins two phases.
   */
  private async readGroupBouts(groups: Map<string, Group>): Promise<Map<string, Row[]>> {
    const byPhase = new Map<ScanPhase, Group[]>();
    for (const group of groups.values()) {
      byPhase.set(group.phase, [...(byPhase.get(group.phase) ?? []), group]);
    }
    const bouts = new Map<string, Row[]>();
    for (const [phase, inPhase] of byPhase) {
      for (const bout of await this.readPhaseBouts(phase, inPhase)) {
        const key = groupKey(
          phase,
          phase.pool ? ((bout['pool_id'] as string | null) ?? null) : null,
        );
        bouts.set(key, [...(bouts.get(key) ?? []), bout]);
      }
    }
    return bouts;
  }

  private async readPhaseBouts(phase: ScanPhase, groups: Group[]): Promise<Row[]> {
    const bouts = (narrow: (query: PageQuery) => PageQuery) =>
      this.paged(() =>
        narrow(
          this.db
            .from('matches')
            .select('id, phase_id, pool_id, status, ended_at, updated_at, locked_at')
            .eq('phase_id', phase.id),
        ),
      );
    if (!phase.pool) return bouts((query) => query);
    const poolIds = groups.flatMap((group) => (group.poolId === null ? [] : [group.poolId]));
    const pooled: Row[] = [];
    for (const piece of inListChunks(poolIds)) {
      pooled.push(...(await bouts((query) => query.in('pool_id', piece))));
    }
    if (!groups.some((group) => group.poolId === null)) return pooled;
    return [...pooled, ...(await bouts((query) => query.is('pool_id', null)))];
  }

  /**
   * Every row of one read, page after page by id: PostgREST cuts a read at 1000 rows and says
   * nothing. Once the module closes, no further page is read.
   */
  private async paged(query: () => PageQuery): Promise<Row[]> {
    const { rows } = await readEveryRowById<Row>(
      (after) => {
        const ordered = query().order('id');
        return (after === undefined ? ordered : ordered.gt('id', after)).limit(READ_PAGE);
      },
      { shouldStop: () => this.closing },
    );
    return rows;
  }

  /** `paged`, once per piece of `IN_LIST_MAX` values: a long `.in()` list outgrows the URL. */
  private async pagedIn(values: unknown[], query: (piece: unknown[]) => PageQuery): Promise<Row[]> {
    const rows: Row[] = [];
    for (const piece of inListChunks([...new Set(values)])) {
      rows.push(...(await this.paged(() => query(piece))));
    }
    return rows;
  }

  /** A group locks once every bout in it is finished and its wait is over. */
  private async lockIfDone(group: Row[], config: TournamentLockConfig, now: Date): Promise<number> {
    if (group.length === 0) return 0;
    if (!group.every((match) => FINISHED.includes(String(match['status'])))) return 0;
    if (!this.delayElapsed(group, config.autoLockDelayMinutes, now)) return 0;
    let locked = 0;
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

  /**
   * The service-role client, typed as the slice the pages use (as `archive.service.ts` does): the
   * full builder type is too deep for the compiler to match against it.
   */
  private get db(): { from(table: string): { select(columns: string): PageQuery } } {
    return this.supabase.service as unknown as {
      from(table: string): { select(columns: string): PageQuery };
    };
  }
}
