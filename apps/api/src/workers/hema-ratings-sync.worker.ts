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
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { SupabaseService } from '../modules/supabase/supabase.service';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HemaRatingsFighter {
  /** Numeric HEMA Ratings ID (null if not yet resolved) */
  id: number | null;
  /** Full name as displayed on hemaratings.com */
  name: string;
  /** Club name */
  club: string;
}

export const HEMA_RATINGS_QUEUE = 'hema-ratings-sync';
export const HEMA_RATINGS_JOB = 'sync';

// ── Worker ────────────────────────────────────────────────────────────────────

@Processor(HEMA_RATINGS_QUEUE)
@Injectable()
export class HemaRatingsSyncWorker extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(HemaRatingsSyncWorker.name);

  constructor(
    @InjectQueue(HEMA_RATINGS_QUEUE) private readonly queue: Queue,
    private readonly supabase: SupabaseService,
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
    this.logger.log(`Starting HEMA Ratings sync (job ${job.id})`);

    const fighters = await this.fetchFighters();
    this.logger.log(`Fetched ${fighters.length} fighters from hemaratings.com`);

    await this.storeSnapshot(fighters);
    this.logger.log(`Snapshot stored (${fighters.length} fighters)`);
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
}
