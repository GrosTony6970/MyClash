import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export interface HemaRatingsSearchResult {
  id: string;
  name: string;
  club: string;
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

function monthToIso(month: string | undefined): string | null {
  if (!month) return null;
  const parsed = Date.parse(`${month} 1 UTC`);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
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

  const ratings: HemaRatingsRow[] = [];
  const ratingsHeader = lines.findIndex((line) => line.startsWith('Category Rank'));
  const recordStart = lines.findIndex(
    (line, idx) => idx > ratingsHeader && line.toLowerCase() === 'record',
  );
  const ratingLines = lines.slice(
    ratingsHeader + 1,
    recordStart > ratingsHeader ? recordStart : lines.length,
  );

  let weapon = '';
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

  return {
    id,
    name,
    club: clubLine?.replace(/^Club\s+/, '') ?? '',
    nationality: nationalityLine?.replace(/^Nationality\s+/, '') ?? null,
    detailsUrl: `https://hemaratings.com/fighters/details/${id}/`,
    ratings,
  };
}

@Injectable()
export class HemaRatingsService {
  constructor(private readonly supabase: SupabaseService) {}

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

    return fighters
      .map((fighter) => ({ fighter, score: scoreFighter(fighter, q) }))
      .filter(({ fighter, score }) => score > 0 && fighter.id !== null && fighter.id !== undefined)
      .sort((a, b) => b.score - a.score || a.fighter.name.localeCompare(b.fighter.name))
      .slice(0, cappedLimit)
      .map(({ fighter }) => {
        const id = String(fighter.id);
        return {
          id,
          name: fighter.name,
          club: fighter.club ?? '',
          detailsUrl: `https://hemaratings.com/fighters/details/${id}/`,
        };
      });
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
