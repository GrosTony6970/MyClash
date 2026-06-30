/**
 * member-stats.service.ts
 *
 * Compact per-fighter stats for "My Groups" member cards. Reuses the
 * `compact_fighter_stats` Postgres function (0114) so the win/loss rule stays in
 * one place and matches the public career profile (fighter-career.ts). One RPC +
 * one batched select hydrate an entire group regardless of member count.
 */
import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export interface CompactStats {
  matches: number;
  wins: number;
  losses: number;
  /** Integer percent 0–100; null when matches === 0 (avoids div-by-zero). */
  winRate: number | null;
  eventsAttended: number;
}

const ZERO: CompactStats = { matches: 0, wins: 0, losses: 0, winRate: null, eventsAttended: 0 };

@Injectable()
export class MemberStatsService {
  constructor(private readonly supabase: SupabaseService) {}

  /** Map global_person_id → compact career stats. Missing ids default to zero. */
  async getCompactStats(globalPersonIds: string[]): Promise<Map<string, CompactStats>> {
    const ids = [...new Set(globalPersonIds.filter(Boolean))];
    const map = new Map<string, CompactStats>();
    if (ids.length === 0) return map;

    const { data, error } = await this.supabase.service.rpc('compact_fighter_stats', {
      p_ids: ids,
    });
    if (error || !data) return map; // cards degrade to zero rather than failing the page

    for (const raw of data as Array<Record<string, unknown>>) {
      const matches = Number(raw['matches'] ?? 0);
      const wins = Number(raw['wins'] ?? 0);
      const losses = Number(raw['losses'] ?? 0);
      map.set(raw['global_person_id'] as string, {
        matches,
        wins,
        losses,
        winRate: matches === 0 ? null : Math.round((wins / matches) * 100),
        eventsAttended: Number(raw['events_attended'] ?? 0),
      });
    }
    return map;
  }

  /** Map global_person_id → favorite weapon name (or null). Favorite first, then
   *  lowest sort_order — mirrors getFighterWeaponLinks ordering. */
  async getFavoriteWeapons(globalPersonIds: string[]): Promise<Map<string, string | null>> {
    const ids = [...new Set(globalPersonIds.filter(Boolean))];
    const map = new Map<string, string | null>();
    if (ids.length === 0) return map;

    const { data } = await this.supabase.service
      .from('fighter_weapons')
      .select('global_person_id, favorite, sort_order, weapon_catalog(name)')
      .in('global_person_id', ids)
      .order('favorite', { ascending: false })
      .order('sort_order', { ascending: true });

    for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
      const gp = raw['global_person_id'] as string;
      if (map.has(gp)) continue; // first row wins (favorite, then lowest sort_order)
      const weapon = raw['weapon_catalog'] as { name?: string } | null;
      map.set(gp, weapon?.name ?? null);
    }
    return map;
  }

  static zero(): CompactStats {
    return { ...ZERO };
  }
}
