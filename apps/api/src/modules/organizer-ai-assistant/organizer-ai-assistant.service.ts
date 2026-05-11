import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AIUsageService } from '../ai-usage/ai-usage.service';
import { EventsService } from '../events/events.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { PhasesService } from '../phases/phases.service';
import { SupabaseService } from '../supabase/supabase.service';
import type {
  CreateOrganizerAIDraftDto,
  OrganizerAIDraftType,
  UpdateOrganizerAIDraftDto,
} from './dto/organizer-ai-assistant.dto';

type DraftStatus = 'draft' | 'ready' | 'failed' | 'applied' | 'rejected';

interface EventRow {
  id: string;
  organization_id: string;
  name?: string | null;
}

interface DraftRow {
  id: string;
  event_id: string;
  tournament_id?: string | null;
  actor_user_id?: string | null;
  draft_type: OrganizerAIDraftType;
  prompt: string;
  summary?: string | null;
  proposed_actions_json: Array<Record<string, unknown>>;
  validation_state: Record<string, unknown>;
  status: DraftStatus;
  error?: string | null;
  created_at?: string;
  updated_at?: string;
  events?: { organization_id?: string | null } | null;
}

interface ParsedAIDraft {
  summary: string;
  actions: Array<Record<string, unknown>>;
  warnings: string[];
}

const FEATURE = 'organizer_tournament_assistant';

@Injectable()
export class OrganizerAIAssistantService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly aiUsage: AIUsageService,
    private readonly organizations: OrganizationsService,
    private readonly events: EventsService,
    private readonly phases: PhasesService,
  ) {}

  async createDraft(eventId: string, actorUserId: string, dto: CreateOrganizerAIDraftDto) {
    const event = await this.getEvent(eventId);
    await this.organizations.assertOrgRole(event.organization_id, actorUserId, 'admin');
    await this.assertOrganizerAIKey(event.organization_id);

    const result = await this.aiUsage.generateWithCap(event.organization_id, eventId, FEATURE, {
      system: this.systemPrompt(dto.draftType),
      user: this.userPrompt(event, dto),
      model: 'default',
      maxTokens: 1800,
      temperature: 0.2,
    });

    const parsed = this.parseAIResult(result.text);
    const validation = parsed.ok
      ? this.validateActions(dto.draftType, parsed.value.actions)
      : { ok: false, warnings: [], errors: [parsed.error] };

    const status: DraftStatus = parsed.ok && validation.ok ? 'ready' : 'failed';
    const row = {
      event_id: eventId,
      tournament_id: dto.tournamentId ?? null,
      actor_user_id: actorUserId,
      draft_type: dto.draftType,
      prompt: dto.prompt.trim(),
      summary: parsed.ok ? parsed.value.summary : null,
      proposed_actions_json: parsed.ok ? parsed.value.actions : [],
      validation_state: {
        ok: validation.ok,
        warnings: parsed.ok ? [...parsed.value.warnings, ...validation.warnings] : [],
        errors: validation.errors,
      },
      status,
      error: status === 'failed' ? validation.errors.join('; ') : null,
      ai_usage_feature: FEATURE,
    };

    const { data, error } = await this.supabase.service
      .from('organizer_ai_assistant_drafts')
      .insert(row)
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to save draft');

    await this.audit(actorUserId, eventId, 'event.ai_assistant_draft_created', data['id'], {
      draftType: dto.draftType,
      status,
      tournamentId: dto.tournamentId ?? null,
    });

    return this.mapDraft(data as DraftRow);
  }

  async listDrafts(eventId: string, actorUserId: string) {
    const event = await this.getEvent(eventId);
    await this.organizations.assertOrgRole(event.organization_id, actorUserId, 'admin');
    const { data, error } = await this.supabase.service
      .from('organizer_ai_assistant_drafts')
      .select('*')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as DraftRow[]).map((row) => this.mapDraft(row));
  }

  async getDraft(eventId: string, draftId: string, actorUserId: string) {
    const draft = await this.getDraftRow(eventId, draftId);
    await this.assertDraftAccess(draft, actorUserId);
    return this.mapDraft(draft);
  }

  async updateDraft(
    eventId: string,
    draftId: string,
    actorUserId: string,
    dto: UpdateOrganizerAIDraftDto,
  ) {
    const draft = await this.getDraftRow(eventId, draftId);
    await this.assertDraftAccess(draft, actorUserId);

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.summary !== undefined) updates['summary'] = dto.summary;
    if (dto.proposedActions !== undefined) {
      const validation = this.validateActions(draft.draft_type, dto.proposedActions);
      updates['proposed_actions_json'] = dto.proposedActions;
      updates['validation_state'] = validation;
      updates['status'] = validation.ok ? (dto.status ?? 'ready') : 'failed';
      updates['error'] = validation.ok ? null : validation.errors.join('; ');
    }
    if (dto.validationState !== undefined) updates['validation_state'] = dto.validationState;
    if (dto.status === 'rejected') {
      updates['status'] = 'rejected';
      updates['rejected_at'] = new Date().toISOString();
      updates['rejected_by_user_id'] = actorUserId;
    }

    const { data, error } = await this.supabase.service
      .from('organizer_ai_assistant_drafts')
      .update(updates)
      .eq('id', draftId)
      .eq('event_id', eventId)
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to update draft');

    await this.audit(actorUserId, eventId, 'event.ai_assistant_draft_updated', draftId, {
      status: updates['status'] ?? draft.status,
      draftType: draft.draft_type,
    });

    return this.mapDraft(data as DraftRow);
  }

  async applyDraft(eventId: string, draftId: string, actorUserId: string) {
    const draft = await this.getDraftRow(eventId, draftId);
    await this.assertDraftAccess(draft, actorUserId);
    if (draft.status !== 'ready') throw new BadRequestException('Only ready drafts can be applied');

    const validation = this.validateActions(draft.draft_type, draft.proposed_actions_json);
    if (!validation.ok) throw new BadRequestException(validation.errors.join('; '));

    const appliedResults = [];
    for (const action of draft.proposed_actions_json) {
      appliedResults.push(await this.applyAction(eventId, actorUserId, action));
    }

    await this.supabase.service
      .from('organizer_ai_assistant_drafts')
      .update({
        status: 'applied',
        applied_at: new Date().toISOString(),
        applied_by_user_id: actorUserId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', draftId);

    await this.audit(actorUserId, eventId, 'event.ai_assistant_draft_applied', draftId, {
      draftType: draft.draft_type,
      actionCount: draft.proposed_actions_json.length,
    });

    return { id: draftId, status: 'applied', appliedResults };
  }

  private async applyAction(eventId: string, actorUserId: string, action: Record<string, unknown>) {
    const kind = action['kind'];
    if (kind === 'create_tournament') {
      const result = await this.events.createTournament(
        eventId,
        {
          name: String(action['name']),
          slug: String(action['slug']),
          weapon: typeof action['weapon'] === 'string' ? action['weapon'] : undefined,
          category: typeof action['category'] === 'string' ? action['category'] : undefined,
          rulesetCode: typeof action['rulesetCode'] === 'string' ? action['rulesetCode'] : 'TF_v1',
        },
        actorUserId,
      );
      return { kind, result };
    }
    if (kind === 'generate_pools') {
      await this.assertTournamentBelongsToEvent(eventId, String(action['tournamentId']));
      const result = await this.phases.generatePools(
        String(action['tournamentId']),
        {
          poolCount: this.optionalNumber(action['poolCount']),
          targetSize: this.optionalNumber(action['targetSize']),
          enforceSchoolSeparation: this.optionalBoolean(action['enforceSchoolSeparation']),
          enforceSkillBalance: this.optionalBoolean(action['enforceSkillBalance']),
          seed: this.optionalNumber(action['seed']),
        },
        Boolean(action['force']),
      );
      return { kind, result };
    }
    if (kind === 'generate_bracket') {
      await this.assertTournamentBelongsToEvent(eventId, String(action['tournamentId']));
      const bracketDto: Record<string, unknown> = {
        qualifyCount: this.optionalNumber(action['qualifyCount']),
        bracketSize: this.optionalNumber(action['bracketSize']),
        poolPhaseId: typeof action['poolPhaseId'] === 'string' ? action['poolPhaseId'] : undefined,
      };
      if (action['phaseType'] === 'double_elim' || action['phaseType'] === 'single_elim') {
        bracketDto['phaseType'] = action['phaseType'];
      }
      const result = await this.phases.generateBracket(
        String(action['tournamentId']),
        bracketDto as never,
        Boolean(action['force']),
      );
      return { kind, result };
    }
    if (kind === 'schedule_match') {
      await Promise.all([
        this.assertMatchBelongsToEvent(eventId, String(action['matchId'])),
        this.assertLiceBelongsToEvent(eventId, String(action['liceId'])),
      ]);
      const { data, error } = await this.supabase.service
        .from('matches')
        .update({
          lice_id: String(action['liceId']),
          scheduled_at: String(action['scheduledAt']),
        })
        .eq('id', String(action['matchId']))
        .select('id')
        .single();
      if (error) throw new BadRequestException(error.message);
      return { kind, result: data };
    }
    if (kind === 'assign_referee') {
      if (typeof action['poolId'] === 'string') {
        await this.assertPoolBelongsToEvent(eventId, action['poolId']);
      }
      if (typeof action['matchId'] === 'string') {
        await this.assertMatchBelongsToEvent(eventId, action['matchId']);
      }
      const { data, error } = await this.supabase.service
        .from('referee_assignments')
        .insert({
          event_id: eventId,
          user_id: String(action['userId']),
          pool_id: typeof action['poolId'] === 'string' ? action['poolId'] : null,
          match_id: typeof action['matchId'] === 'string' ? action['matchId'] : null,
          role: String(action['role']),
          status: 'assigned',
          auto_assigned: false,
          notes: 'AI assistant draft applied by organizer',
        })
        .select('id')
        .single();
      if (error) throw new BadRequestException(error.message);
      return { kind, result: data };
    }
    throw new BadRequestException(`Unsupported draft action: ${String(kind)}`);
  }

  private validateActions(
    draftType: OrganizerAIDraftType,
    actions: Array<Record<string, unknown>>,
  ) {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!Array.isArray(actions) || actions.length === 0) errors.push('Draft must contain actions');

    for (const action of actions) {
      const kind = action['kind'];
      if (draftType === 'tournament_config' && kind !== 'create_tournament') {
        errors.push('Tournament drafts can only create tournaments');
      }
      if (draftType === 'pool_plan' && kind !== 'generate_pools') {
        errors.push('Pool drafts can only generate pools');
      }
      if (draftType === 'bracket_plan' && kind !== 'generate_bracket') {
        errors.push('Bracket drafts can only generate brackets');
      }
      if (draftType === 'schedule_grid' && kind !== 'schedule_match') {
        errors.push('Schedule drafts can only schedule matches');
      }
      if (draftType === 'referee_assignments' && kind !== 'assign_referee') {
        errors.push('Referee drafts can only assign referees');
      }
      this.validateActionShape(action, errors);
    }

    return { ok: errors.length === 0, warnings, errors };
  }

  private validateActionShape(action: Record<string, unknown>, errors: string[]) {
    const kind = action['kind'];
    if (kind === 'create_tournament') {
      if (!this.nonEmpty(action['name'])) errors.push('Tournament name is required');
      if (!this.nonEmpty(action['slug'])) errors.push('Tournament slug is required');
    } else if (kind === 'generate_pools') {
      if (!this.nonEmpty(action['tournamentId']))
        errors.push('Pool draft tournamentId is required');
      if (action['poolCount'] === undefined && action['targetSize'] === undefined) {
        errors.push('Pool draft requires poolCount or targetSize');
      }
    } else if (kind === 'generate_bracket') {
      if (!this.nonEmpty(action['tournamentId'])) {
        errors.push('Bracket draft tournamentId is required');
      }
    } else if (kind === 'schedule_match') {
      if (!this.nonEmpty(action['matchId'])) errors.push('Schedule matchId is required');
      if (!this.nonEmpty(action['liceId'])) errors.push('Schedule liceId is required');
      if (!this.nonEmpty(action['scheduledAt'])) errors.push('Schedule scheduledAt is required');
    } else if (kind === 'assign_referee') {
      if (!this.nonEmpty(action['userId'])) errors.push('Referee userId is required');
      if (!this.nonEmpty(action['role'])) errors.push('Referee role is required');
      if (!this.nonEmpty(action['poolId']) && !this.nonEmpty(action['matchId'])) {
        errors.push('Referee assignment requires poolId or matchId');
      }
    } else {
      errors.push(`Unsupported draft action: ${String(kind)}`);
    }
  }

  private parseAIResult(
    text: string,
  ): { ok: true; value: ParsedAIDraft } | { ok: false; error: string } {
    try {
      const parsed = JSON.parse(text) as Partial<ParsedAIDraft>;
      if (!Array.isArray(parsed.actions)) throw new Error('Missing actions array');
      return {
        ok: true,
        value: {
          summary: typeof parsed.summary === 'string' ? parsed.summary : '',
          actions: parsed.actions,
          warnings: Array.isArray(parsed.warnings)
            ? parsed.warnings.filter((warning): warning is string => typeof warning === 'string')
            : [],
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'AI returned invalid JSON',
      };
    }
  }

  private async getEvent(eventId: string): Promise<EventRow> {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('id, organization_id, name')
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Event ${eventId} not found`);
    return data as EventRow;
  }

  private async assertOrganizerAIKey(orgId: string) {
    const { data, error } = await this.supabase.service
      .from('organization_ai_settings')
      .select('provider')
      .eq('organization_id', orgId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('No AI provider configured for this organization');
  }

  private async assertTournamentBelongsToEvent(eventId: string, tournamentId: string) {
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .select('id')
      .eq('id', tournamentId)
      .eq('event_id', eventId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException('Tournament must belong to this event');
  }

  private async assertLiceBelongsToEvent(eventId: string, liceId: string) {
    const { data, error } = await this.supabase.service
      .from('lices')
      .select('id')
      .eq('id', liceId)
      .eq('event_id', eventId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException('Lice must belong to this event');
  }

  private async assertPoolBelongsToEvent(eventId: string, poolId: string) {
    const { data, error } = await this.supabase.service
      .from('pools')
      .select('id, phases(tournaments(event_id))')
      .eq('id', poolId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    const phase = (
      data as { phases?: { tournaments?: { event_id?: string } | null } | null } | null
    )?.phases;
    if (phase?.tournaments?.event_id !== eventId) {
      throw new BadRequestException('Pool must belong to this event');
    }
  }

  private async assertMatchBelongsToEvent(eventId: string, matchId: string) {
    const { data, error } = await this.supabase.service
      .from('matches')
      .select('id, phases(tournaments(event_id))')
      .eq('id', matchId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    const phase = (
      data as { phases?: { tournaments?: { event_id?: string } | null } | null } | null
    )?.phases;
    if (phase?.tournaments?.event_id !== eventId) {
      throw new BadRequestException('Match must belong to this event');
    }
  }

  private async getDraftRow(eventId: string, draftId: string): Promise<DraftRow> {
    const { data, error } = await this.supabase.service
      .from('organizer_ai_assistant_drafts')
      .select('*, events(organization_id)')
      .eq('id', draftId)
      .eq('event_id', eventId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`AI assistant draft ${draftId} not found`);
    return data as DraftRow;
  }

  private async assertDraftAccess(draft: DraftRow, actorUserId: string) {
    const orgId = draft.events?.organization_id;
    if (!orgId) throw new BadRequestException('Draft organization could not be resolved');
    await this.organizations.assertOrgRole(orgId, actorUserId, 'admin');
  }

  private systemPrompt(draftType: OrganizerAIDraftType) {
    return [
      'You are the MyClash organizer tournament setup assistant.',
      'Return strict JSON only with keys: summary, actions, warnings.',
      'Never invent IDs. Use IDs present in the organizer context.',
      `Draft type: ${draftType}.`,
    ].join('\n');
  }

  private userPrompt(event: EventRow, dto: CreateOrganizerAIDraftDto) {
    return JSON.stringify({
      event: { id: event.id, name: event.name ?? null },
      tournamentId: dto.tournamentId ?? null,
      organizerPrompt: dto.prompt,
    });
  }

  private mapDraft(row: DraftRow | Record<string, unknown>) {
    return {
      id: row['id'],
      eventId: row['event_id'],
      tournamentId: row['tournament_id'] ?? null,
      draftType: row['draft_type'],
      prompt: row['prompt'],
      summary: row['summary'] ?? null,
      proposedActions: row['proposed_actions_json'] ?? [],
      validationState: row['validation_state'] ?? { ok: false, warnings: [] },
      status: row['status'],
      error: row['error'] ?? null,
      createdAt: row['created_at'],
      updatedAt: row['updated_at'],
    };
  }

  private async audit(
    actorUserId: string,
    eventId: string,
    action: string,
    draftId: unknown,
    payload: Record<string, unknown>,
  ) {
    await this.supabase.service.from('audit_log').insert({
      actor_user_id: actorUserId,
      action,
      entity_type: 'organizer_ai_assistant_draft',
      entity_id: draftId,
      payload_json: payload,
    });
  }

  private nonEmpty(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private optionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private optionalBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
  }
}
