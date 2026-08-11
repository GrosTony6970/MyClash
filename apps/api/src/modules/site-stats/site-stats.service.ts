import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type { SiteStatsDto } from './dto/site-stats.dto';

/**
 * The three numbers the marketing site puts above the fold.
 *
 * They were hardcoded there — 120 tournaments, 45 clubs, 3 000 fighters,
 * animated by a JS counter — and none of them was true. Published adoption
 * claims have to come from the database or not be made at all, which is also
 * why every count here degrades to 0 rather than to a plausible-looking
 * number: the caller renders nothing when a count is 0, so a broken query
 * produces an absent section, never a fabricated one.
 */

interface CountQuery {
  eq(column: string, value: unknown): CountQuery;
  neq(column: string, value: unknown): CountQuery;
  in(column: string, values: readonly unknown[]): CountQuery;
  then: Promise<{ count: number | null; error: unknown }>['then'];
}

/**
 * Event states a visitor can see. Mirrors `listEvents` in events.service.ts and
 * the partial index `idx_events_status_start_date` (migration 0162) — if this
 * drifts from that predicate, the landing page advertises a different number of
 * events than the page it links to lists.
 */
const PUBLIC_EVENT_STATUSES = ['published', 'running', 'completed'] as const;

@Injectable()
export class SiteStatsService {
  private readonly logger = new Logger(SiteStatsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async getPublicStats(): Promise<SiteStatsDto> {
    const [events, clubs, fighters] = await Promise.all([
      this.count('events', (query) =>
        query.in('status', PUBLIC_EVENT_STATUSES).neq('event_kind', 'test'),
      ),
      this.count('clubs'),
      this.count('global_persons', (query) => query.eq('is_fighter', true)),
    ]);

    return { events, clubs, fighters };
  }

  /**
   * `head: true` with `count: 'exact'` sends the count in a header and no rows —
   * PostgREST rejects aggregate functions in `select`, so this is the only way
   * to count without pulling the table.
   */
  private async count(table: string, apply?: (query: CountQuery) => CountQuery): Promise<number> {
    try {
      let query = this.supabase.service
        .from(table)
        .select('*', { count: 'exact', head: true }) as unknown as CountQuery;
      if (apply) query = apply(query);

      const { count, error } = await query;
      if (error) {
        this.logger.warn(`site stats: counting ${table} failed; reporting 0.`);
        return 0;
      }
      return count ?? 0;
    } catch {
      this.logger.warn(`site stats: counting ${table} threw; reporting 0.`);
      return 0;
    }
  }
}
