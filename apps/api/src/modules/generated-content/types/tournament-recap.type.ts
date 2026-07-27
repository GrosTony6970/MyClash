import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { computeFinalRanking, rankingBracketShape, type RankingSlot } from '@myclash/types';
import { EventsService } from '../../events/events.service';
import { OrganizationsService } from '../../organizations/organizations.service';
import { SupabaseService } from '../../supabase/supabase.service';
import type { ContentTypeDef, GenScope } from '../content-type.interface';

interface TournamentRow {
  id: string;
  name: string;
  weapon: string | null;
  ruleset_code: string | null;
  event_id: string;
  slug: string;
  events: { slug: string; organization_id: string } | null;
}

/** AI recap of a completed tournament — grounded in the public standings + podium. */
@Injectable()
export class TournamentRecapType implements ContentTypeDef {
  readonly contentType = 'tournament_recap';
  readonly entityType = 'tournament';
  readonly keySource = 'org' as const;
  readonly canPublish = true;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly events: EventsService,
    private readonly orgs: OrganizationsService,
  ) {}

  private async loadTournament(tournamentId: string): Promise<TournamentRow> {
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .select('id, name, weapon, ruleset_code, event_id, slug, events(slug, organization_id)')
      .eq('id', tournamentId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Tournament ${tournamentId} not found`);
    return data as unknown as TournamentRow;
  }

  async resolveScope(entityId: string): Promise<GenScope> {
    const t = await this.loadTournament(entityId);
    if (!t.events?.organization_id)
      throw new NotFoundException('Tournament organization not found');
    return { orgId: t.events.organization_id, eventId: t.event_id };
  }

  async assertAccess(entityId: string, userId: string): Promise<void> {
    const t = await this.loadTournament(entityId);
    if (!t.events?.organization_id)
      throw new NotFoundException('Tournament organization not found');
    await this.orgs.assertOrgRole(t.events.organization_id, userId, 'admin');
  }

  async buildContext(entityId: string): Promise<Record<string, unknown>> {
    const t = await this.loadTournament(entityId);
    if (!t.events?.slug) throw new NotFoundException('Tournament event not found');
    // Reuse the tested public assembly; its bracketSlots map 1:1 to RankingSlot.
    const standings = await this.events.getPublicTournamentStandings(t.events.slug, t.slug);
    const header = standings.tournament as Record<string, unknown>;
    const slots = (standings as { bracketSlots?: RankingSlot[] }).bracketSlots ?? [];
    // The cast must expose the WHOLE shape, not just phaseType: narrowing it
    // dropped wbRounds/lbRounds, which left a double-elim recap ranked as if
    // its losers bracket were part of the winners tree.
    const podium = computeFinalRanking(
      slots,
      [],
      null,
      rankingBracketShape(standings as Parameters<typeof rankingBracketShape>[0]),
    )
      .slice(0, 4)
      .map((e) => ({ place: e.place, fighter: e.fighterName, club: e.clubAbbrev ?? null }));
    return {
      tournament: t.name,
      weapon: t.weapon,
      ruleset: t.ruleset_code,
      participantCount: header['participantCount'] ?? 0,
      completedMatchCount: header['completedMatchCount'] ?? 0,
      poolCount: header['poolCount'] ?? 0,
      podium,
    };
  }

  systemPrompt(locale: string): string {
    return [
      'You write a short, engaging recap of a completed HEMA (historical fencing) tournament.',
      'You are given a JSON object of FACTS. Use ONLY those facts — never invent fighters, clubs, scores, or results.',
      'Lead with the champion, then the rest of the podium; mention the scale (participants, matches) and the weapon.',
      'Keep it to 2-4 short paragraphs, warm and factual. No headings, no markdown tables.',
      `Write in this language (ISO code): ${locale}.`,
    ].join('\n');
  }
}
