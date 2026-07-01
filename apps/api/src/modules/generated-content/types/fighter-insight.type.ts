import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { MemberStatsService } from '../../directory-groups/member-stats.service';
import { SupabaseService } from '../../supabase/supabase.service';
import type { ContentTypeDef } from '../content-type.interface';

/**
 * Personalized AI performance insight for a fighter, in /me. Runs on the
 * fighter's OWN key (keySource 'fighter'); self-service only — a fighter can
 * generate/publish only their own insight (their claimed global_person).
 */
@Injectable()
export class FighterInsightType implements ContentTypeDef {
  readonly contentType = 'fighter_insight';
  readonly entityType = 'global_person';
  readonly keySource = 'fighter' as const;
  readonly canPublish = true;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly memberStats: MemberStatsService,
  ) {}

  async assertAccess(entityId: string, userId: string): Promise<void> {
    const { data, error } = await this.supabase.service
      .from('global_persons')
      .select('id')
      .eq('claimed_by_user_id', userId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    const mine = (data as { id: string } | null)?.id ?? null;
    if (!mine || mine !== entityId) {
      throw new ForbiddenException('You can only generate your own insight');
    }
  }

  async buildContext(entityId: string): Promise<Record<string, unknown>> {
    const [statsMap, weaponMap] = await Promise.all([
      this.memberStats.getCompactStats([entityId]),
      this.memberStats.getFavoriteWeapons([entityId]),
    ]);
    const stats = statsMap.get(entityId) ?? MemberStatsService.zero();
    return {
      matches: stats.matches,
      wins: stats.wins,
      losses: stats.losses,
      winRatePercent: stats.winRate,
      eventsAttended: stats.eventsAttended,
      favoriteWeapon: weaponMap.get(entityId) ?? null,
    };
  }

  systemPrompt(locale: string): string {
    return [
      'You write a short, encouraging performance insight for a HEMA (historical fencing) competitor, addressed to them ("you").',
      'You are given a JSON object of FACTS about their record. Use ONLY those facts — never invent results, opponents, or numbers.',
      'Highlight what stands out (win rate, activity across events, favourite weapon) and keep it positive and specific.',
      'If they have very few matches, acknowledge they are just getting started rather than over-claiming.',
      'Keep it to 1-2 short paragraphs. No headings, no markdown tables.',
      `Write in this language (ISO code): ${locale}.`,
    ].join('\n');
  }
}
