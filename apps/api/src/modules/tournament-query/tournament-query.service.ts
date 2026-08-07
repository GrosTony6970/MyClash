import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { countRows } from '../../common/pg-aggregate';
import { AIUsageService } from '../ai-usage/ai-usage.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import type { TournamentQueryDto, TournamentQuerySettingsDto } from './dto/tournament-query.dto';
import {
  buildTournamentToolDefinitions,
  detectQueryLanguage,
  normalizeQuestionAliases,
  validateToolCall,
} from './tournament-query.tools';
import { TournamentQueryToolsService } from './tournament-query.tools.service';
import type {
  QueryEstimateResponse,
  QueryLanguage,
  QueryResponse,
  ToolCall,
  ToolResult,
  TournamentContext,
} from './tournament-query.types';

const FEATURE = 'natural_language_query';
const DEFAULT_RATE_LIMIT = 60;
const ESTIMATED_COST_EUR = 0.003;

type TournamentRow = {
  id: string;
  event_id: string;
  name: string;
  weapon?: string | null;
  events?: { organization_id?: string | null } | null;
};

type QuerySettingsRow = {
  access_policy?: string | null;
  rate_limit_per_hour?: number | null;
};

@Injectable()
export class TournamentQueryService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly organizations: OrganizationsService,
    private readonly aiUsage: AIUsageService,
    private readonly tools: TournamentQueryToolsService,
  ) {}

  async estimate(
    tournamentId: string,
    actorUserId: string,
    dto: TournamentQueryDto,
  ): Promise<QueryEstimateResponse> {
    this.assertQuestion(dto.question);
    const tournament = await this.getTournamentContext(tournamentId);
    await this.assertAccess(tournament, actorUserId);
    const usage = await this.aiUsage.getUsageSummary(tournament.eventId);
    return {
      estimatedCostEur: ESTIMATED_COST_EUR,
      currentSpend: usage.totalSpendEur,
      cap: usage.cap,
      allowed: usage.cap === null || usage.totalSpendEur + ESTIMATED_COST_EUR <= usage.cap,
    };
  }

  async query(
    tournamentId: string,
    actorUserId: string,
    dto: TournamentQueryDto,
  ): Promise<QueryResponse> {
    const question = this.assertQuestion(dto.question);
    const language = detectQueryLanguage(question);
    const tournament = await this.getTournamentContext(tournamentId);
    const settings = await this.getSettings(tournamentId);
    await this.assertAccess(tournament, actorUserId, settings);
    await this.assertOrganizerAIKey(tournament.organizationId);
    await this.assertRateLimit(tournamentId, actorUserId, settings.rateLimitPerHour);

    const toolContext = await this.tools.getToolContext(tournament);
    const generation = await this.aiUsage.generateWithCap(
      tournament.organizationId,
      tournament.eventId,
      FEATURE,
      {
        system: this.systemPrompt(language),
        user: JSON.stringify({
          tournament: {
            id: tournament.tournamentId,
            name: tournament.name,
            weapon: tournament.weapon,
          },
          language,
          question: normalizeQuestionAliases(question),
        }),
        model: 'default',
        maxTokens: 900,
        temperature: 0.1,
        tools: buildTournamentToolDefinitions(toolContext),
        toolChoice: 'required',
      },
    );

    const toolCall = generation.toolCall as ToolCall | undefined;
    if (!toolCall) {
      const response = this.messageResponse(
        'clarification',
        language,
        this.clarification(language),
        generation.costEur,
      );
      await this.persistHistory(
        tournament,
        actorUserId,
        question,
        language,
        null,
        null,
        generation.costEur,
      );
      return response;
    }

    const validation = validateToolCall(toolCall, toolContext);
    if (!validation.ok) {
      const response = this.messageResponse(
        'clarification',
        language,
        validation.message ?? this.clarification(language),
        generation.costEur,
      );
      await this.persistHistory(
        tournament,
        actorUserId,
        question,
        language,
        toolCall.name,
        response.message ?? null,
        generation.costEur,
      );
      return response;
    }

    const result = await this.tools.execute(tournament, toolCall.name, toolCall.arguments);
    const summary = await this.maybeSummarize(tournament, question, language, result);
    await this.persistHistory(
      tournament,
      actorUserId,
      question,
      language,
      toolCall.name,
      summary.text ?? result.title,
      generation.costEur + summary.cost,
    );
    const usage = await this.aiUsage.getUsageSummary(tournament.eventId);
    return {
      kind: 'result',
      language,
      toolCalled: toolCall.name,
      result,
      summary: summary.text || undefined,
      costEur: generation.costEur + summary.cost,
      totalSpendEur: usage.totalSpendEur,
    };
  }

  async history(tournamentId: string, actorUserId: string) {
    const tournament = await this.getTournamentContext(tournamentId);
    await this.assertAccess(tournament, actorUserId);
    const { data, error } = await this.supabase.service
      .from('tournament_query_history')
      .select('question, language, tool_name, summary, cost_eur, created_at')
      .eq('tournament_id', tournamentId)
      .eq('user_id', actorUserId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new BadRequestException(error.message);
    return { queries: data ?? [] };
  }

  async getSettingsForTournament(tournamentId: string, actorUserId: string) {
    const tournament = await this.getTournamentContext(tournamentId);
    await this.organizations.assertOrgRole(tournament.organizationId, actorUserId, 'admin');
    return this.getSettings(tournamentId);
  }

  async saveSettings(tournamentId: string, actorUserId: string, dto: TournamentQuerySettingsDto) {
    const tournament = await this.getTournamentContext(tournamentId);
    await this.organizations.assertOrgRole(tournament.organizationId, actorUserId, 'admin');
    const rateLimit = dto.rateLimitPerHour ?? DEFAULT_RATE_LIMIT;
    if (!Number.isInteger(rateLimit) || rateLimit < 1 || rateLimit > 500) {
      throw new BadRequestException('Rate limit must be between 1 and 500 queries per hour');
    }
    const accessPolicy = dto.accessPolicy ?? 'organizers_only';
    if (
      ![
        'organizers_only',
        'organizers_head_judges',
        'organizers_head_judges_coaches',
        'anyone_with_tournament_access',
      ].includes(accessPolicy)
    ) {
      throw new BadRequestException('Invalid query access policy');
    }
    const { data, error } = await this.supabase.service
      .from('tournament_query_settings')
      .upsert({
        tournament_id: tournamentId,
        access_policy: accessPolicy,
        rate_limit_per_hour: rateLimit,
        updated_by_user_id: actorUserId,
        updated_at: new Date().toISOString(),
      })
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return this.mapSettings(data as QuerySettingsRow);
  }

  private async getTournamentContext(tournamentId: string): Promise<TournamentContext> {
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .select('id, event_id, name, weapon, events(organization_id)')
      .eq('id', tournamentId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Tournament ${tournamentId} not found`);
    const row = data as TournamentRow;
    const organizationId = row.events?.organization_id;
    if (!organizationId)
      throw new BadRequestException('Tournament organization could not be resolved');
    return {
      tournamentId: row.id,
      eventId: row.event_id,
      organizationId,
      name: row.name,
      weapon: row.weapon ?? null,
      weapons: row.weapon ? [row.weapon] : [],
      poolIds: [],
      liceNumbers: [],
      divisions: [],
    };
  }

  private async getSettings(tournamentId: string) {
    const { data, error } = await this.supabase.service
      .from('tournament_query_settings')
      .select('access_policy, rate_limit_per_hour')
      .eq('tournament_id', tournamentId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return this.mapSettings(data as QuerySettingsRow | null);
  }

  private mapSettings(row: QuerySettingsRow | null) {
    return {
      accessPolicy: row?.access_policy ?? 'organizers_only',
      rateLimitPerHour: row?.rate_limit_per_hour ?? DEFAULT_RATE_LIMIT,
    };
  }

  private async assertAccess(
    tournament: TournamentContext,
    actorUserId: string,
    settings: { accessPolicy: string } = { accessPolicy: 'organizers_only' },
  ) {
    if (!actorUserId || actorUserId === 'anonymous') {
      throw new UnauthorizedException('Authentication required');
    }
    if (settings.accessPolicy === 'organizers_only') {
      await this.organizations.assertOrgRole(tournament.organizationId, actorUserId, 'admin');
      return;
    }
    try {
      await this.organizations.assertOrgRole(tournament.organizationId, actorUserId, 'admin');
      return;
    } catch (error) {
      if (settings.accessPolicy === 'anyone_with_tournament_access') {
        const { data } = await this.supabase.service
          .from('persons')
          .select('id')
          .eq('event_id', tournament.eventId)
          .eq('claimed_by_user_id', actorUserId)
          .maybeSingle();
        if (data) return;
      }
      throw error;
    }
  }

  private async assertOrganizerAIKey(orgId: string) {
    const { data, error } = await this.supabase.service
      .from('organization_ai_keys')
      .select('id')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('No AI provider configured for this organization');
  }

  private async assertRateLimit(tournamentId: string, userId: string, limit: number) {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    // Counted in JS: `id.count()` is a server-side aggregate, which PostgREST
    // rejects with aggregates disabled (the default, and what this stack runs).
    // Unlike the AI budget call sites this one DID surface the error — so with
    // aggregates off, every natural-language query 400'd here before reaching
    // the model. See `common/pg-aggregate.ts`.
    const count = await countRows((from, to) =>
      this.supabase.service
        .from('tournament_query_history')
        .select('id')
        .eq('tournament_id', tournamentId)
        .eq('user_id', userId)
        .gte('created_at', since)
        .range(from, to),
    );
    if (count >= limit) {
      throw new BadRequestException('Natural-language query rate limit reached');
    }
  }

  private async maybeSummarize(
    tournament: TournamentContext,
    question: string,
    language: QueryLanguage,
    result: ToolResult,
  ): Promise<{ text: string | null; cost: number }> {
    const rowCount = result.metadata.row_count ?? result.rows?.length ?? result.items?.length ?? 0;
    if (!['table', 'comparison', 'summary_stats'].includes(result.render_hint) || rowCount <= 3) {
      return { text: null, cost: 0 };
    }
    const generated = await this.aiUsage.generateWithCap(
      tournament.organizationId,
      tournament.eventId,
      FEATURE,
      {
        system:
          language === 'fr'
            ? 'Resume ce resultat en UNE phrase francaise, maximum 30 mots. Utilise seulement les faits fournis.'
            : 'Summarise this result in ONE sentence, max 30 words. Use only facts from the data.',
        user: JSON.stringify({ question, result }),
        model: 'default',
        maxTokens: 80,
        temperature: 0.2,
      },
    );
    return { text: generated.text.trim() || null, cost: generated.costEur };
  }

  private async persistHistory(
    tournament: TournamentContext,
    userId: string,
    question: string,
    language: QueryLanguage,
    toolName: string | null,
    summary: string | null,
    costEur: number,
  ) {
    await this.supabase.service.from('tournament_query_history').insert({
      tournament_id: tournament.tournamentId,
      event_id: tournament.eventId,
      user_id: userId,
      question,
      language,
      tool_name: toolName,
      summary,
      cost_eur: costEur,
    });
  }

  private messageResponse(
    kind: 'clarification' | 'refusal',
    language: QueryLanguage,
    message: string,
    costEur: number,
  ): QueryResponse {
    return { kind, language, message, costEur, totalSpendEur: costEur };
  }

  private systemPrompt(language: QueryLanguage) {
    return [
      'You are a query assistant for MyClash, a HEMA tournament management platform.',
      'Convert the user question about THIS tournament into exactly one tool call.',
      'Never write SQL. Never invent data. Never predict outcomes. Never widen tournament scope.',
      'If the question is vague, ask one short clarification instead of guessing.',
      'If out of scope, refuse briefly.',
      `Answer clarifications/refusals in ${language === 'fr' ? 'French' : 'English'}.`,
    ].join('\n');
  }

  private clarification(language: QueryLanguage) {
    return language === 'fr'
      ? 'Pouvez-vous preciser la poule, la piste, le tireur ou l arme ?'
      : 'Please specify the pool, lice, fighter, or weapon.';
  }

  private assertQuestion(question: string) {
    const trimmed = question?.trim();
    if (!trimmed) throw new BadRequestException('Question is required');
    if (trimmed.length > 500) throw new BadRequestException('Question is too long');
    return trimmed;
  }
}
