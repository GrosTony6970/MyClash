/**
 * hema-ratings-sync.worker.ts — T-1101
 *
 * BullMQ worker + daily cron that pulls the HEMA Ratings fighter index
 * from https://hemaratings.com/fighters/ and stores it in
 * `hema_ratings_snapshots`.
 *
 * The page is HTML-only (no public API). We parse the fighter list from
 * the HTML response. Each fighter entry has a name and club; the numeric
 * HEMA Ratings ID is embedded in the per-fighter detail URL but is NOT
 * present on the listing page — we store what we can (name + club) and
 * leave id=null for now. The ID can be populated later via T-1102 when
 * an organizer explicitly links a registration.
 *
 * Queue name: "hema-ratings-sync"
 * Job name:   "sync"
 * Cron:       daily at 03:30 UTC (after the nightly backup at 03:00)
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { SentryReportingWorkerHost } from './sentry-reporting-worker-host';
import { AdminFeatureFlagsService } from '../modules/admin/admin-feature-flags.service';
import { SupabaseService } from '../modules/supabase/supabase.service';
import {
  fetchHemaRatingsProfile,
  type HemaRatingsProfile,
} from '../modules/hema-ratings/hema-ratings.service';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HemaRatingsFighter {
  /** Numeric HEMA Ratings ID (null if not yet resolved) */
  id: number | null;
  /** Full name as displayed on hemaratings.com */
  name: string;
  /** Club name */
  club: string;
  /** Enriched profile details for linked MyClash fighters */
  nationality?: string | null;
  detailsUrl?: string;
  ratings?: HemaRatingsProfile['ratings'];
}

export const HEMA_RATINGS_QUEUE = 'hema-ratings-sync';
export const HEMA_RATINGS_JOB = 'sync';

// ── Worker ────────────────────────────────────────────────────────────────────

@Processor(HEMA_RATINGS_QUEUE)
@Injectable()
export class HemaRatingsSyncWorker extends SentryReportingWorkerHost implements OnModuleInit {
  private readonly logger = new Logger(HemaRatingsSyncWorker.name);

  constructor(
    @InjectQueue(HEMA_RATINGS_QUEUE) private readonly queue: Queue,
    private readonly supabase: SupabaseService,
    private readonly flags: AdminFeatureFlagsService,
  ) {
    super();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    // Schedule the daily cron job if it doesn't already exist.
    // BullMQ repeatable jobs are idempotent by key — safe to call on every start.
    await this.queue.add(
      HEMA_RATINGS_JOB,
      {},
      {
        repeat: {
          // Daily at 03:30 UTC
          pattern: '30 3 * * *',
        },
        jobId: 'hema-ratings-daily-sync',
      },
    );
    this.logger.log('HEMA Ratings daily sync job scheduled (03:30 UTC)');
  }

  // ── Job handler ────────────────────────────────────────────────────────────

  async process(job: Job): Promise<void> {
    if (await this.flags.isEnabled('disable_hema_sync')) {
      this.logger.log(`HEMA sync skipped: disable_hema_sync flag is on (job ${job.id})`);
      return;
    }
    this.logger.log(`Starting HEMA Ratings sync (job ${job.id})`);

    try {
      const fighters = await this.fetchFighters();
      this.logger.log(`Fetched ${fighters.length} fighters from hemaratings.com`);

      const linkedProfiles = await this.fetchLinkedProfiles();
      this.logger.log(`Enriched ${linkedProfiles.size} linked HEMA Ratings profiles`);

      const enriched = fighters.map((fighter) => {
        const profile = fighter.id !== null ? linkedProfiles.get(String(fighter.id)) : undefined;
        return profile
          ? {
              ...fighter,
              name: profile.name,
              club: profile.club,
              nationality: profile.nationality,
              detailsUrl: profile.detailsUrl,
              ratings: profile.ratings,
            }
          : fighter;
      });

      for (const [id, profile] of linkedProfiles) {
        if (!enriched.some((fighter) => String(fighter.id) === id)) {
          enriched.push({
            id: parseInt(id, 10),
            name: profile.name,
            club: profile.club,
            nationality: profile.nationality,
            detailsUrl: profile.detailsUrl,
            ratings: profile.ratings,
          });
        }
      }

      await this.storeSnapshot(enriched);
      this.logger.log(`Snapshot stored (${enriched.length} fighters)`);

      // Append today's rating points for the ranking-history chart, and seed the
      // series from accumulated snapshots on first run. Non-fatal: a failure here
      // must not fail the sync itself.
      await this.captureRatingHistory(linkedProfiles);
      await this.backfillHistoryIfEmpty();
    } catch (error) {
      // Log + rethrow so BullMQ surfaces the failure to the retry pipeline
      // (attempts + exponential back-off configured on the queue). Without
      // an explicit log here, failures vanish into the failed-jobs list
      // with no breadcrumb in the application logs.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`HEMA Ratings sync failed (job ${job.id}): ${message}`);
      throw error;
    }
  }

  // ── Fetch ──────────────────────────────────────────────────────────────────

  /**
   * Fetch the full fighter list from hemaratings.com/fighters/.
   * The page is a single large HTML document listing all fighters alphabetically.
   * Each fighter appears as:
   *   <fighter-name>\n    \n<club-name>
   * We parse the text content of the page.
   */
  private async fetchFighters(): Promise<HemaRatingsFighter[]> {
    const url = 'https://hemaratings.com/fighters/';

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'MyClash/1.0 (HEMA event management platform; contact: admin@myclash.fr)',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`hemaratings.com returned HTTP ${response.status} for ${url}`);
    }

    const html = await response.text();
    return this.parseHtml(html);
  }

  /**
   * Parse the HTML from hemaratings.com/fighters/.
   *
   * The page structure (from inspection) is a list of fighter entries.
   * Each entry contains the fighter name and club name as text nodes.
   * We use a regex-based approach since we can't run a DOM parser server-side
   * without additional dependencies.
   *
   * Pattern observed:
   *   <a href="/fighters/details/NNN/">
   *     FighterName
   *   </a>
   *   ...
   *   ClubName
   *
   * We extract name + club pairs. The numeric ID is in the href.
   */
  private parseHtml(html: string): HemaRatingsFighter[] {
    const fighters: HemaRatingsFighter[] = [];

    // Match fighter detail links: /fighters/details/NNN/
    // Each link contains the fighter name as text content.
    // After the link, the club name appears as text.
    const fighterPattern = /href="\/fighters\/details\/(\d+)\/"[^>]*>\s*([\s\S]*?)\s*<\/a>/g;

    // We'll collect all fighter links first, then try to extract club names
    // by looking at the text between consecutive fighter entries.
    const matches: Array<{ id: number; name: string; startIndex: number }> = [];

    let match: RegExpExecArray | null;
    while ((match = fighterPattern.exec(html)) !== null) {
      const idStr = match[1];
      const rawNameRaw = match[2];
      if (!idStr || !rawNameRaw) continue;

      const id = parseInt(idStr, 10);
      const rawName = rawNameRaw
        .replace(/<[^>]+>/g, '') // strip any inner tags
        .replace(/\s+/g, ' ')
        .trim();

      if (rawName && rawName.length > 0 && rawName.length < 200) {
        matches.push({ id, name: rawName, startIndex: match.index });
      }
    }

    // For each fighter, extract the club name from the text between this
    // fighter's link end and the next fighter's link start.
    for (let i = 0; i < matches.length; i++) {
      const current = matches[i];
      if (!current) continue;

      const nextStart =
        i + 1 < matches.length ? (matches[i + 1]?.startIndex ?? html.length) : html.length;

      // Get the HTML segment between this fighter and the next
      const segment = html.slice(current.startIndex, nextStart);

      // Extract text nodes (strip all HTML tags)
      const textContent = segment
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // The club name is the last meaningful text segment after the fighter name
      // Remove the fighter name from the beginning
      const afterName = textContent.replace(current.name, '').replace(/\s+/g, ' ').trim();

      // Club name is the remaining text (may be empty if no club)
      const club = afterName.length > 0 && afterName.length < 200 ? afterName : '';

      fighters.push({
        id: current.id,
        name: current.name,
        club,
      });
    }

    return fighters;
  }

  private async fetchLinkedProfiles(): Promise<Map<string, HemaRatingsProfile>> {
    const { data, error } = await this.supabase.service
      .from('global_persons')
      .select('hema_ratings_id')
      .not('hema_ratings_id', 'is', null);

    if (error) {
      throw new Error(`Failed to load linked HEMA Ratings IDs: ${error.message}`);
    }

    const ids = Array.from(
      new Set(
        ((data ?? []) as Array<{ hema_ratings_id: string | null }>)
          .map((fighter) => fighter.hema_ratings_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    const profiles = new Map<string, HemaRatingsProfile>();
    for (const id of ids) {
      try {
        // Shared HTTP fetch + parse helper; same path the admin "refresh
        // single fighter" endpoint uses.
        profiles.set(id, await fetchHemaRatingsProfile(id));
      } catch (error) {
        this.logger.warn(
          `Failed to enrich HEMA Ratings profile ${id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return profiles;
  }

  // ── Store ──────────────────────────────────────────────────────────────────

  private async storeSnapshot(fighters: HemaRatingsFighter[]): Promise<void> {
    const { error } = await this.supabase.service.from('hema_ratings_snapshots').insert({
      fighters: fighters as unknown as Record<string, unknown>[],
      fighter_count: fighters.length,
      synced_at: new Date().toISOString(),
    });

    if (error) {
      throw new Error(`Failed to store HEMA Ratings snapshot: ${error.message}`);
    }
  }

  // ── Rating history (chart time-series) ───────────────────────────────────────

  /** Append today's rating point per linked fighter × weapon × category. */
  private async captureRatingHistory(profiles: Map<string, HemaRatingsProfile>): Promise<void> {
    const capturedAt = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const rows: Record<string, unknown>[] = [];
    for (const [id, profile] of profiles) {
      for (const rating of profile.ratings ?? []) {
        if (rating.weightedRating == null || !rating.weapon) continue;
        rows.push({
          hema_ratings_id: id,
          weapon: rating.weapon,
          category: rating.category ?? '',
          weighted_rating: rating.weightedRating,
          rank: rating.rank ?? null,
          captured_at: capturedAt,
        });
      }
    }
    await this.upsertHistoryRows(rows);
  }

  /**
   * Seed the history table from accumulated daily snapshots the first time it's
   * empty, so the chart has real backdated points immediately after deploy.
   */
  private async backfillHistoryIfEmpty(): Promise<void> {
    const { count, error: countError } = await this.supabase.service
      .from('hema_rating_history')
      .select('id', { count: 'exact', head: true });
    if (countError || (count ?? 0) > 0) return;

    const { data, error } = await this.supabase.service
      .from('hema_ratings_snapshots')
      .select('synced_at, fighters')
      .order('synced_at', { ascending: true });
    if (error || !data) return;

    const rows: Record<string, unknown>[] = [];
    for (const snapshot of data as Array<{ synced_at: string; fighters: unknown }>) {
      const capturedAt = String(snapshot.synced_at).slice(0, 10);
      const fighters = Array.isArray(snapshot.fighters)
        ? (snapshot.fighters as Array<{ id?: unknown; ratings?: HemaRatingsProfile['ratings'] }>)
        : [];
      for (const fighter of fighters) {
        const id = fighter.id == null ? '' : String(fighter.id);
        if (!id) continue;
        for (const rating of fighter.ratings ?? []) {
          if (rating.weightedRating == null || !rating.weapon) continue;
          rows.push({
            hema_ratings_id: id,
            weapon: rating.weapon,
            category: rating.category ?? '',
            weighted_rating: rating.weightedRating,
            rank: rating.rank ?? null,
            captured_at: capturedAt,
          });
        }
      }
    }
    await this.upsertHistoryRows(rows);
    this.logger.log(`Backfilled ${rows.length} HEMA rating-history points from snapshots`);
  }

  /** Chunked idempotent upsert on the (id, weapon, category, captured_at) key. */
  private async upsertHistoryRows(rows: Record<string, unknown>[]): Promise<void> {
    if (rows.length === 0) return;
    const CHUNK = 1000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await this.supabase.service
        .from('hema_rating_history')
        .upsert(rows.slice(i, i + CHUNK), {
          onConflict: 'hema_ratings_id,weapon,category,captured_at',
        });
      if (error) {
        this.logger.warn(`Failed to write HEMA rating history: ${error.message}`);
        return;
      }
    }
  }
}
