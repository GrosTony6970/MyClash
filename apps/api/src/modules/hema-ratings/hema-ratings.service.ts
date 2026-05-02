import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export interface HemaRatingsSearchResult {
  id: string;
  name: string;
  club: string;
  detailsUrl: string;
}

interface SnapshotFighter {
  id: number | string | null;
  name: string;
  club?: string | null;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
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
}
