import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type {
  RuntimeHealthResponseDto,
  RuntimeHealthSample,
  RuntimeHealthSeriesResponseDto,
} from './dto/runtime-health.dto';

/** How long a sample is kept. ~670 rows at the quiet 15-min cadence. */
export const RETENTION_DAYS = 7;

/** Guards the series endpoint; a caller asking for more than we retain gets what exists. */
const MAX_WINDOW_HOURS = RETENTION_DAYS * 24;

interface SampleRow {
  sampled_at: string;
  overall: RuntimeHealthSample['overall'];
  conn_in_use: number | null;
  conn_max: number | null;
  db_size_bytes: number | null;
  longest_query_seconds: number | string | null;
  cache_hit_ratio: number | string | null;
  redis_used_bytes: number | null;
  redis_max_bytes: number | null;
  queue_waiting: number | null;
  queue_failed: number | null;
  disk_use_pct: number | string | null;
}

/**
 * Persists the monitor's ticks so the Runtime Health card can show a trend
 * rather than only a live reading.
 *
 * ONE writer, on purpose: the monitor worker. AdminRuntimeHealthService.collect()
 * also backs the admin GET endpoint, so recording inside it would append a row
 * on every page view and turn "how often did this degrade" into "how often did
 * someone look".
 */
@Injectable()
export class RuntimeHealthSamplesService {
  private readonly logger = new Logger(RuntimeHealthSamplesService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Best-effort: a failed write must never take down the monitor tick that
   * produced it, because that tick's real job is sending the alert email.
   * Returns whether the row landed, for tests and logging.
   */
  async record(snapshot: RuntimeHealthResponseDto): Promise<boolean> {
    const db = snapshot.database.status === 'unavailable' ? null : snapshot.database;
    const redis = snapshot.redis.status === 'unavailable' ? null : snapshot.redis;
    const queues = snapshot.queues.status === 'unavailable' ? null : snapshot.queues;
    const disk = snapshot.disk.status === 'unavailable' ? null : snapshot.disk;

    const { error } = await this.supabase.service.from('runtime_health_samples').insert({
      sampled_at: snapshot.checkedAt,
      overall: snapshot.overall,
      conn_in_use: db?.connections.inUse ?? null,
      conn_max: db?.connections.max ?? null,
      db_size_bytes: db?.databaseSizeBytes ?? null,
      longest_query_seconds: db?.longestQuerySeconds ?? null,
      cache_hit_ratio: db?.cacheHitRatio ?? null,
      redis_used_bytes: redis?.usedMemoryBytes ?? null,
      redis_max_bytes: redis?.maxMemoryBytes ?? null,
      queue_waiting: queues?.totalWaiting ?? null,
      queue_failed: queues?.totalFailed ?? null,
      disk_use_pct: disk?.usePercent ?? null,
    });

    if (error) {
      this.logger.warn(`Could not record runtime health sample: ${error.message}`);
      return false;
    }
    return true;
  }

  /**
   * Drops samples past the retention window. Runs on the same tick as record()
   * rather than on its own schedule so there is exactly one thing to reason
   * about — if the monitor stops, the table stops growing too.
   */
  async prune(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await this.supabase.service
      .from('runtime_health_samples')
      .delete()
      .lt('sampled_at', cutoff)
      .select('sampled_at');

    if (error) {
      this.logger.warn(`Could not prune runtime health samples: ${error.message}`);
      return 0;
    }
    return data?.length ?? 0;
  }

  /** Newest-last series for the last `hours`, for the admin trend view. */
  async getSeries(hours: number, now: Date = new Date()): Promise<RuntimeHealthSeriesResponseDto> {
    const clamped = Math.min(Math.max(Math.trunc(hours) || 1, 1), MAX_WINDOW_HOURS);
    const since = new Date(now.getTime() - clamped * 60 * 60 * 1000).toISOString();

    const { data, error } = await this.supabase.service
      .from('runtime_health_samples')
      // ONE string literal, deliberately not concatenated. The client parses
      // this at the type level, and a `'a, b' + 'c'` expression degrades the
      // row type to GenericStringError[] — the cast below then fails to compile.
      // Wrapping is fine; splitting it into joined pieces is not.
      .select(
        'sampled_at, overall, conn_in_use, conn_max, db_size_bytes, longest_query_seconds, cache_hit_ratio, redis_used_bytes, redis_max_bytes, queue_waiting, queue_failed, disk_use_pct',
      )
      .gte('sampled_at', since)
      .order('sampled_at', { ascending: true });

    if (error) throw new Error(error.message);
    return { since, samples: ((data ?? []) as SampleRow[]).map(toSample) };
  }
}

/**
 * PostgREST returns `numeric` as a STRING to preserve precision, so
 * cache_hit_ratio / longest_query_seconds / disk_use_pct arrive as text while
 * the int and bigint columns arrive as numbers. Charting a string silently
 * produces a flat line, so every numeric is coerced here rather than at the
 * call site.
 */
function num(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(parsed) ? parsed : null;
}

function toSample(row: SampleRow): RuntimeHealthSample {
  return {
    sampledAt: row.sampled_at,
    overall: row.overall,
    connInUse: row.conn_in_use,
    connMax: row.conn_max,
    dbSizeBytes: row.db_size_bytes,
    longestQuerySeconds: num(row.longest_query_seconds),
    cacheHitRatio: num(row.cache_hit_ratio),
    redisUsedBytes: row.redis_used_bytes,
    redisMaxBytes: row.redis_max_bytes,
    queueWaiting: row.queue_waiting,
    queueFailed: row.queue_failed,
    diskUsePct: num(row.disk_use_pct),
  };
}
