import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { SupabaseService } from '../supabase/supabase.service';

/** Queue name re-exported here so callers don't reach into workers/. */
export const HEMA_RATINGS_QUEUE_NAME = 'hema-ratings-sync';
export const HEMA_RATINGS_SYNC_JOB = 'sync';

const HEMA_RATINGS_USER_AGENT =
  'MyClash/1.0 (HEMA event management platform; contact: admin@myclash.fr)';
const HEMA_RATINGS_INDEX_URL = 'https://hemaratings.com/fighters/';

/**
 * Fetch + parse a single fighter's HEMA Ratings profile from the upstream
 * detail page. Exposed at module scope so both the daily-sync worker and
 * the admin "refresh this fighter" endpoint share the same fetch path.
 */
export async function fetchHemaRatingsProfile(id: string): Promise<HemaRatingsProfile> {
  const url = `https://hemaratings.com/fighters/details/${id}/`;
  const response = await fetch(url, {
    headers: { 'User-Agent': HEMA_RATINGS_USER_AGENT, Accept: 'text/html' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`hemaratings.com returned HTTP ${response.status} for ${url}`);
  }
  return parseHemaRatingsDetailHtml(id, await response.text());
}

export interface HemaRatingsSearchResult {
  id: string;
  name: string;
  club: string;
  /**
   * Fighter's country. Null when the snapshot entry hasn't been enriched
   * yet — the search endpoint pre-enriches results when missing, and the
   * /sync endpoint writes nationality into the snapshot on selection, so
   * repeat searches of the same fighter are warm.
   */
  nationality: string | null;
  detailsUrl: string;
}

export interface HemaRatingsRow {
  weapon: string;
  category: string;
  rank: number | null;
  weightedRating: number;
  lastCompeted: string | null;
}

export interface HemaRatingsProfile {
  id: string;
  name: string;
  club: string;
  nationality?: string | null;
  detailsUrl: string;
  ratings: HemaRatingsRow[];
}

export interface HemaRatingsProfileResponse extends HemaRatingsProfile {
  syncedAt: string;
}

// ── Admin surface types ─────────────────────────────────────────────────────

export interface TrackedFighterRow {
  /** global_persons.id */
  globalPersonId: string;
  /** global_persons.slug — used for cross-links to the fighter profile. */
  slug: string | null;
  /** Display name, prefers global_persons.display_name. */
  displayName: string;
  givenName: string | null;
  familyName: string | null;
  clubName: string | null;
  photoUrl: string | null;
  /** The HEMA Ratings numeric ID stored on global_persons.hema_ratings_id. */
  hemaRatingsId: string;
  /** Latest snapshot synced_at timestamp (null when no snapshot exists yet). */
  syncedAt: string | null;
  /** Profile ratings for this fighter from the latest snapshot. */
  ratings: HemaRatingsRow[];
  /** Most-recent lastCompeted across all weapons (display convenience). */
  lastCompeted: string | null;
  /** True when the latest snapshot has no profile for this fighter. */
  profileMissing: boolean;
}

export interface SyncHistoryEntry {
  id: string;
  syncedAt: string;
  fighterCount: number;
}

export interface HemaRatingsHealthResult {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  error?: string;
}

interface SnapshotFighter {
  id: number | string | null;
  name: string;
  club?: string | null;
  nationality?: string | null;
  detailsUrl?: string | null;
  ratings?: HemaRatingsRow[] | null;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeToken(value: string): string {
  return normalize(value).replace(/[^a-z0-9]+/g, '');
}

function scoreFighter(fighter: SnapshotFighter, query: string): number {
  const q = normalize(query);
  const name = normalize(fighter.name);
  const club = normalize(fighter.club ?? '');
  const haystack = `${name} ${club}`.trim();

  if (!q) return 0;
  if (name === q) return 100;
  if (name.startsWith(q)) return 80;
  if (haystack.includes(q)) return 60;

  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  return tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 10 : 0), 0);
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function htmlToLines(html: string): string[] {
  return decodeHtml(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(h[1-6]|p|div|li|tr|table|section)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function cleanHtmlText(html: string): string {
  return decodeHtml(
    html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function monthToIso(month: string | undefined): string | null {
  if (!month) return null;
  const parsed = Date.parse(`${month} 1 UTC`);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function parseCurrentRank(value: string): number | null {
  const match = value.match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

function parseCurrentWeightedRating(value: string): number | null {
  const match = value.match(/\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

function extractProfileTableField(html: string, label: string): string | null {
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const row = rowMatch[1] ?? '';
    const cells = Array.from(row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((match) =>
      cleanHtmlText(match[1] ?? ''),
    );
    if (cells.length < 2) continue;
    if (cells[0]?.toLowerCase() === label.toLowerCase()) return cells[1] ?? null;
  }
  return null;
}

function parseCurrentRatingsTable(html: string): HemaRatingsRow[] {
  const ratingsHeading = html.search(/<h3[^>]*>\s*Ratings\s*<\/h3>/i);
  if (ratingsHeading < 0) return [];

  const tableStart = html.indexOf('<table', ratingsHeading);
  if (tableStart < 0) return [];
  const tableEnd = html.indexOf('</table>', tableStart);
  if (tableEnd < tableStart) return [];
  const tableHtml = html.slice(tableStart, tableEnd + '</table>'.length);

  const ratings: HemaRatingsRow[] = [];
  let weapon = '';
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowPattern.exec(tableHtml)) !== null) {
    const row = rowMatch[1] ?? '';
    const weaponMatch = row.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i);
    if (weaponMatch) {
      weapon = cleanHtmlText(weaponMatch[1] ?? '');
      continue;
    }

    const cells = Array.from(row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((match) =>
      cleanHtmlText(match[1] ?? ''),
    );
    if (cells.length < 4 || !weapon) continue;

    const category = (cells[0] ?? '').replace(/^-\s*/, '').trim();
    const lastCompeted = monthToIso(cells[1]) ?? null;
    const rank = parseCurrentRank(cells[2] ?? '');
    const weightedRating = parseCurrentWeightedRating(cells[3] ?? '');
    if (!category || weightedRating === null) continue;

    ratings.push({
      weapon,
      category,
      rank,
      weightedRating,
      lastCompeted,
    });
  }

  return ratings;
}

function extractHistoryMonths(lines: string[]): Map<string, string> {
  const result = new Map<string, string>();
  const start = lines.findIndex((line) => line.toLowerCase() === 'full rating histories');
  if (start < 0) return result;

  let category: string | null = null;
  for (const line of lines.slice(start + 1)) {
    if (/^[A-Za-z]+\s+\d{4}$/.test(line)) {
      if (category) result.set(normalizeToken(category), monthToIso(line) ?? line);
      continue;
    }
    if (
      !/^\d+(?:\.\d+)?$/.test(line) &&
      !line.toLowerCase().includes('island') &&
      line.length > 3
    ) {
      category = line;
    }
  }
  return result;
}

export function parseHemaRatingsDetailHtml(id: string, html: string): HemaRatingsProfile {
  const lines = htmlToLines(html);
  const historyMonths = extractHistoryMonths(lines);

  const headingMatch = html.match(/<h[12][^>]*>\s*([\s\S]*?)\s*<\/h[12]>/i);
  const name = headingMatch?.[1]
    ? decodeHtml(
        headingMatch[1]
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
      )
    : (lines.find(
        (line) => !line.includes('HEMA Ratings') && !line.includes('Skip to main content'),
      ) ?? '');
  const clubLine = lines.find((line) => line.startsWith('Club '));
  const nationalityLine = lines.find((line) => line.startsWith('Nationality '));

  const ratings: HemaRatingsRow[] = parseCurrentRatingsTable(html);
  const ratingsHeader = lines.findIndex((line) => line.startsWith('Category Rank'));
  const recordStart = lines.findIndex(
    (line, idx) => idx > ratingsHeader && line.toLowerCase() === 'record',
  );
  const ratingLines = lines.slice(
    ratingsHeader + 1,
    recordStart > ratingsHeader ? recordStart : lines.length,
  );

  let weapon = '';
  if (ratings.length === 0) {
    for (const line of ratingLines) {
      if (line.startsWith('Category Rank')) continue;
      if (!line.startsWith('- ')) {
        weapon = line;
        continue;
      }

      const row = line
        .replace(/^-\s*/, '')
        .match(
          /^(.+?)\s+(\d+)(?:\s+\([^)]+\))?\s+(\d+(?:\.\d+)?)\s+\d+(?:\s+\([^)]+\))?\s+\d+(?:\.\d+)?/,
        );
      if (!row || !row[1] || !row[3]) continue;

      const category = row[1].trim();
      ratings.push({
        weapon,
        category,
        rank: row[2] ? parseInt(row[2], 10) : null,
        weightedRating: parseFloat(row[3]),
        lastCompeted: historyMonths.get(normalizeToken(category)) ?? null,
      });
    }
  }

  return {
    id,
    name,
    club: extractProfileTableField(html, 'Club') ?? clubLine?.replace(/^Club\s+/, '') ?? '',
    nationality:
      extractProfileTableField(html, 'Nationality') ??
      nationalityLine?.replace(/^Nationality\s+/, '') ??
      null,
    detailsUrl: `https://hemaratings.com/fighters/details/${id}/`,
    ratings,
  };
}

@Injectable()
export class HemaRatingsService {
  constructor(
    private readonly supabase: SupabaseService,
    /**
     * Optional so callers wiring the service without a BullMQ queue (tests,
     * read-only contexts) don't have to register the queue too. When absent,
     * `enqueueSync` throws a clear error.
     */
    @Optional()
    @InjectQueue(HEMA_RATINGS_QUEUE_NAME)
    private readonly syncQueue?: Queue,
  ) {}

  async search(query: string, limit = 5): Promise<HemaRatingsSearchResult[]> {
    const q = query.trim();
    if (!q) throw new BadRequestException('Query parameter "q" is required');

    const cappedLimit = Math.min(Math.max(limit, 1), 10);
    const { data, error } = await this.supabase.service
      .from('hema_ratings_snapshots')
      .select('fighters')
      .order('synced_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return [];

    const fighters = ((data as { fighters?: unknown }).fighters ?? []) as SnapshotFighter[];

    const matches = fighters
      .map((fighter) => ({ fighter, score: scoreFighter(fighter, q) }))
      .filter(({ fighter, score }) => score > 0 && fighter.id !== null && fighter.id !== undefined)
      .sort((a, b) => b.score - a.score || a.fighter.name.localeCompare(b.fighter.name))
      .slice(0, cappedLimit);

    // Pre-enrich each match with nationality. The snapshot acts as the
    // cache: entries with a non-null nationality come straight back; the
    // rest fan out to fetchHemaRatingsProfile in parallel and write the
    // result back into the snapshot via patchSnapshotEntry. Failures
    // degrade silently to `nationality: null` so a flaky upstream never
    // blocks the picker.
    const enriched = await Promise.all(
      matches.map(async ({ fighter }) => {
        const id = String(fighter.id);
        const base: HemaRatingsSearchResult = {
          id,
          name: fighter.name,
          club: fighter.club ?? '',
          nationality: fighter.nationality ?? null,
          detailsUrl: `https://hemaratings.com/fighters/details/${id}/`,
        };
        if (base.nationality) return base;
        try {
          const profile = await fetchHemaRatingsProfile(id);
          await this.patchSnapshotEntry(profile).catch(() => {
            /* persistence failures don't block the response */
          });
          return { ...base, nationality: profile.nationality ?? null };
        } catch {
          return base;
        }
      }),
    );

    return enriched;
  }

  /**
   * Re-fetch a single fighter's profile by raw HEMA Ratings ID (NOT a
   * global_persons UUID) and patch the latest snapshot in place. Used by
   * the participant-add finder so the picked fighter's snapshot is fresh
   * the next time anyone (search, registration, rating resolution)
   * touches it.
   *
   * Fire-and-forget at the caller: this is intentionally swallowed-error
   * — a transient hemaratings.com hiccup must never bubble up into the
   * participant form.
   */
  async syncByHemaRatingsId(hemaRatingsId: string): Promise<void> {
    try {
      const profile = await fetchHemaRatingsProfile(hemaRatingsId);
      await this.patchSnapshotEntry(profile);
    } catch {
      /* swallow — caller treats this as fire-and-forget */
    }
  }

  /**
   * Update the matching fighter entry in the latest snapshot row with a
   * freshly-fetched profile. Shared by refreshSingleFighter (super-admin
   * surface), syncByHemaRatingsId (org-staff surface), and the search
   * enrichment path. If no snapshot exists yet we silently skip — the
   * next full sync will write a fresh row.
   */
  private async patchSnapshotEntry(profile: HemaRatingsProfile): Promise<void> {
    const { data: latest } = await this.supabase.service
      .from('hema_ratings_snapshots')
      .select('id, fighters')
      .order('synced_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latest) return;

    const row = latest as { id: string; fighters?: unknown };
    const fighters = ((row.fighters ?? []) as SnapshotFighter[]) ?? [];
    const idx = fighters.findIndex((f) => String(f.id) === profile.id);
    const numericId = Number.parseInt(profile.id, 10);
    const enriched: SnapshotFighter = {
      id: Number.isFinite(numericId) ? numericId : profile.id,
      name: profile.name,
      club: profile.club,
      nationality: profile.nationality,
      detailsUrl: profile.detailsUrl,
      ratings: profile.ratings,
    };
    const nextFighters =
      idx >= 0
        ? [...fighters.slice(0, idx), enriched, ...fighters.slice(idx + 1)]
        : [...fighters, enriched];
    await this.supabase.service
      .from('hema_ratings_snapshots')
      .update({ fighters: nextFighters as unknown as Record<string, unknown>[] })
      .eq('id', row.id);
  }

  async getProfile(id: string): Promise<HemaRatingsProfileResponse> {
    const snapshot = await this.latestSnapshot();
    const profile = snapshot.fighters.find((fighter) => String(fighter.id) === id);

    if (!profile || !profile.ratings || profile.ratings.length === 0) {
      throw new NotFoundException(`HEMA Ratings profile ${id} not found`);
    }

    return {
      id,
      name: profile.name,
      club: profile.club ?? '',
      nationality: profile.nationality ?? null,
      detailsUrl: profile.detailsUrl ?? `https://hemaratings.com/fighters/details/${id}/`,
      syncedAt: snapshot.syncedAt,
      ratings: profile.ratings,
    };
  }

  async resolveWeightedRatings(
    hemaRatingsIds: string[],
    weapon: string | null | undefined,
    options: { now?: Date } = {},
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (!weapon || hemaRatingsIds.length === 0) return result;

    const snapshot = await this.latestSnapshot().catch(() => ({ fighters: [], syncedAt: '' }));
    const wanted = new Set(hemaRatingsIds);
    const targetWeapon = normalizeToken(weapon);
    const now = options.now ?? new Date();
    const staleBefore = new Date(now);
    staleBefore.setFullYear(staleBefore.getFullYear() - 2);

    for (const fighter of snapshot.fighters) {
      const id = String(fighter.id);
      if (!wanted.has(id) || !fighter.ratings) continue;

      const candidates = fighter.ratings
        .filter((rating) => normalizeToken(rating.weapon) === targetWeapon)
        .filter((rating) => {
          if (!rating.lastCompeted) return false;
          const competedAt = new Date(rating.lastCompeted);
          return !Number.isNaN(competedAt.getTime()) && competedAt >= staleBefore;
        })
        .sort((a, b) => {
          const dateA = a.lastCompeted ? Date.parse(a.lastCompeted) : 0;
          const dateB = b.lastCompeted ? Date.parse(b.lastCompeted) : 0;
          return dateB - dateA;
        });

      const best = candidates[0];
      if (best) result.set(id, best.weightedRating);
    }

    return result;
  }

  // ── Admin surface ────────────────────────────────────────────────────────

  /**
   * Returns every global_person currently tracked in HEMA Ratings (has a
   * non-null `hema_ratings_id`), joined with their latest profile from the
   * most-recent snapshot. Used by the super-admin "HEMA Ratings" page.
   */
  async listTrackedFighters(): Promise<TrackedFighterRow[]> {
    const { data: persons, error: personsErr } = await this.supabase.service
      .from('global_persons')
      .select(
        'id, slug, display_name, given_name, family_name, hema_ratings_id, photo_url, club_id, clubs(name)',
      )
      .not('hema_ratings_id', 'is', null)
      .order('family_name', { ascending: true });
    if (personsErr) throw new BadRequestException(personsErr.message);

    type Row = {
      id: string;
      slug: string | null;
      display_name: string | null;
      given_name: string | null;
      family_name: string | null;
      hema_ratings_id: string;
      photo_url: string | null;
      club_id: string | null;
      clubs?: { name: string | null } | Array<{ name: string | null }> | null;
    };
    const rows = (persons ?? []) as Row[];
    if (rows.length === 0) return [];

    // Latest snapshot is best-effort — if it's missing we still surface the
    // tracked-fighter list so the operator can see who's tracked even before
    // the first sync has landed.
    let snapshot: { fighters: SnapshotFighter[]; syncedAt: string } | null = null;
    try {
      snapshot = await this.latestSnapshot();
    } catch {
      snapshot = null;
    }
    const profileById = new Map<string, SnapshotFighter>();
    for (const fighter of snapshot?.fighters ?? []) {
      if (fighter.id !== null && fighter.id !== undefined) {
        profileById.set(String(fighter.id), fighter);
      }
    }

    return rows.map((row): TrackedFighterRow => {
      const profile = profileById.get(row.hema_ratings_id);
      const ratings = profile?.ratings ?? [];
      const lastCompeted =
        ratings
          .map((r) => r.lastCompeted)
          .filter((d): d is string => Boolean(d))
          .sort((a, b) => (a < b ? 1 : -1))[0] ?? null;
      const club = Array.isArray(row.clubs) ? row.clubs[0] : row.clubs;
      const displayName =
        row.display_name?.trim() ||
        `${row.given_name ?? ''} ${row.family_name ?? ''}`.trim() ||
        row.hema_ratings_id;

      return {
        globalPersonId: row.id,
        slug: row.slug,
        displayName,
        givenName: row.given_name,
        familyName: row.family_name,
        clubName: club?.name ?? null,
        photoUrl: row.photo_url,
        hemaRatingsId: row.hema_ratings_id,
        syncedAt: snapshot?.syncedAt ?? null,
        ratings,
        lastCompeted,
        profileMissing: !profile || ratings.length === 0,
      };
    });
  }

  /** Last N sync runs, newest first. */
  async getSyncHistory(limit = 10): Promise<SyncHistoryEntry[]> {
    const capped = Math.min(Math.max(limit, 1), 50);
    const { data, error } = await this.supabase.service
      .from('hema_ratings_snapshots')
      .select('id, synced_at, fighter_count')
      .order('synced_at', { ascending: false })
      .limit(capped);
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as Array<{ id: string; synced_at: string; fighter_count: number }>).map(
      (row) => ({ id: row.id, syncedAt: row.synced_at, fighterCount: row.fighter_count }),
    );
  }

  /**
   * Enqueue an immediate sync run. The same BullMQ queue + job name as the
   * daily 03:30 UTC cron — the worker processor picks this up alongside the
   * scheduled jobs.
   */
  async enqueueSync(actorUserId: string): Promise<{ jobId: string }> {
    if (!this.syncQueue) {
      throw new BadRequestException('HEMA Ratings sync queue is not available');
    }
    const job = await this.syncQueue.add(
      HEMA_RATINGS_SYNC_JOB,
      { triggeredBy: actorUserId, triggeredAt: new Date().toISOString() },
      { removeOnComplete: 10, removeOnFail: 10 },
    );
    return { jobId: String(job.id ?? '') };
  }

  /**
   * Re-fetch a single fighter's profile from hemaratings.com and patch the
   * latest snapshot in place. Lets operators see fresh data for one fighter
   * without waiting for (or kicking off) a full ~30k-row sync.
   *
   * Mutating the latest snapshot is the simplest carrier — the next full sync
   * will overwrite the row anyway, and the JSONB patch is small.
   */
  async refreshSingleFighter(globalPersonId: string): Promise<{
    hemaRatingsId: string;
    ratings: HemaRatingsRow[];
  }> {
    const { data: person, error: personErr } = await this.supabase.service
      .from('global_persons')
      .select('id, hema_ratings_id')
      .eq('id', globalPersonId)
      .maybeSingle();
    if (personErr) throw new BadRequestException(personErr.message);
    if (!person) throw new NotFoundException(`Global person ${globalPersonId} not found`);
    const hemaRatingsId = (person as { hema_ratings_id: string | null }).hema_ratings_id;
    if (!hemaRatingsId) {
      throw new BadRequestException(
        `Global person ${globalPersonId} has no hema_ratings_id — nothing to refresh`,
      );
    }

    const profile = await fetchHemaRatingsProfile(hemaRatingsId);
    await this.patchSnapshotEntry(profile);
    return { hemaRatingsId, ratings: profile.ratings };
  }

  /**
   * Synchronously probe hemaratings.com so the admin page can flag upstream
   * outages. Single GET with a short timeout — body discarded.
   */
  async checkHealth(): Promise<HemaRatingsHealthResult> {
    const startedAt = Date.now();
    try {
      const response = await fetch(HEMA_RATINGS_INDEX_URL, {
        method: 'HEAD',
        headers: { 'User-Agent': HEMA_RATINGS_USER_AGENT },
        signal: AbortSignal.timeout(5_000),
      });
      return {
        ok: response.ok,
        status: response.status,
        latencyMs: Date.now() - startedAt,
      };
    } catch (err) {
      return {
        ok: false,
        status: null,
        latencyMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async latestSnapshot(): Promise<{ fighters: SnapshotFighter[]; syncedAt: string }> {
    const { data, error } = await this.supabase.service
      .from('hema_ratings_snapshots')
      .select('fighters, synced_at')
      .order('synced_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) throw new NotFoundException('No HEMA Ratings snapshot found');

    const row = data as { fighters?: unknown; synced_at?: string };
    return {
      fighters: ((row.fighters ?? []) as SnapshotFighter[]) ?? [],
      syncedAt: row.synced_at ?? '',
    };
  }
}
