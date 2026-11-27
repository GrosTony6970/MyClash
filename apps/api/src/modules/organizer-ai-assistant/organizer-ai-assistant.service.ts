import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AIUsageService } from '../ai-usage/ai-usage.service';
import { EventsService } from '../events/events.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { PhasesService } from '../phases/phases.service';
import { MatchPlacementService } from '../matches/match-placement.service';
import { AssignmentBoardService } from '../referees/assignment-board.service';
import { assertRefereeBoardUnlocked } from '../referees/referee-lock';
import { SupabaseService } from '../supabase/supabase.service';
import { insertAuditLog } from '../../common/audit-log';
import { parseModelJson } from '../../common/model-json';
import type {
  CreateOrganizerAIDraftDto,
  OrganizerAIDraftType,
  UpdateOrganizerAIDraftDto,
} from './dto/organizer-ai-assistant.dto';
import { assertMatchesBelongToEvent, assertTournamentsBelongToEvent } from '../events/in-event';
import { readableDraftActions } from './readable-draft';

type DraftStatus = 'draft' | 'ready' | 'failed' | 'applied' | 'rejected';

/**
 * The statuses a draft may still change from. An applied draft's actions ran and a rejected
 * one was refused: both are closed (ruling 994). Marie applies a draft that generates 4 Pools;
 * an edit that made it `ready` again would let a second Apply generate them again.
 */
const OPEN_STATUSES: DraftStatus[] = ['draft', 'ready', 'failed'];

/** The refusal of a change to a closed draft, with a code the page can read. */
function draftClosed(message: string): ConflictException {
  return new ConflictException({ code: 'draft_closed', message });
}

/**
 * Why a draft is closed, or null while it is open. A draft whose Apply started is closed too,
 * even when an action then failed: the claim set `applied_at`, the failure keeps it, and the
 * row reads `failed` ("Partially applied 1/2…"). Its first actions ran, so an edit back to
 * `ready` and a second Apply would run them again (the Tournament created twice). It cannot be
 * rejected either (ruling 997): it stays `failed`, and the page says it was partly applied. A
 * draft that failed the shape check never ran: it has no `applied_at` and stays open.
 */
function closedReason(draft: Pick<DraftRow, 'status' | 'applied_at'>): string | null {
  if (!OPEN_STATUSES.includes(draft.status)) return `This draft is already ${draft.status}.`;
  if (applyStarted(draft)) {
    return 'This draft was partly applied before it failed. It cannot be changed, applied again or rejected.';
  }
  return null;
}

/**
 * Did an Apply of this draft start? The claim sets `applied_at` and nothing clears it, so an
 * applied draft and a partly applied one both answer yes. The page reads it on a `failed` draft
 * to say "partly applied" and to hide Apply and Reject (ruling 997).
 */
function applyStarted(draft: Pick<DraftRow, 'applied_at'>): boolean {
  return Boolean(draft.applied_at);
}

/** A `schedule_match` action as the placement owner takes it: the bout, its piste, its time. */
function schedulePlacement(action: Record<string, unknown>) {
  return {
    matchId: String(action['matchId']),
    liceId: String(action['liceId']),
    scheduledAt: String(action['scheduledAt']),
  };
}

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
  conversation_id?: string | null;
  source?: string | null;
  applied_at?: string | null;
  created_at?: string;
  /** NOT NULL (0031), and every write to the row sets it: the claim matches on it. */
  updated_at: string;
  events?: { organization_id?: string | null } | null;
}

/** Maps a chatbot write-tool name to the single-kind draft_type it produces. */
const ACTION_KIND_TO_DRAFT_TYPE: Record<string, OrganizerAIDraftType> = {
  create_tournament: 'tournament_config',
  generate_pools: 'pool_plan',
  generate_bracket: 'bracket_plan',
  schedule_match: 'schedule_grid',
  assign_referee: 'referee_assignments',
};

/** How a caller of `createDraftFromAction` names the draft it saves. */
export interface ActionDraftOptions {
  /** Who proposed it: the in-app chat, or Claude through the MCP server (call S). */
  source: 'chat' | 'mcp';
  conversationId?: string;
  summary?: string;
  tournamentId?: string | null;
  /** The row's prompt (NOT NULL). Default: the summary, else "<who> proposed: <kind>". */
  prompt?: string;
  /** Merged into the create audit row's payload (MCP: `via`, `clientId`, `clientName`). */
  auditExtra?: Record<string, unknown>;
}

/**
 * The one draft type a list of actions makes (call T): at least one action, all of one
 * kind. A draft type allows one kind, so a mixed list is refused before anything is saved.
 */
function draftTypeOf(actions: Array<Record<string, unknown>>) {
  const kinds = [...new Set(actions.map((action) => String(action['kind'])))];
  if (kinds.length === 0) throw new BadRequestException('A draft needs at least one action');
  if (kinds.length > 1) {
    throw new BadRequestException(`A draft holds actions of one kind, not ${kinds.join(', ')}`);
  }
  const kind = kinds[0] as string;
  // An own key only: `constructor` or `toString` would find Object.prototype's (the kind comes
  // from a model's tool call, through the chat or the MCP server).
  if (!Object.hasOwn(ACTION_KIND_TO_DRAFT_TYPE, kind)) {
    throw new BadRequestException(`Unsupported action: ${kind}`);
  }
  return { kind, draftType: ACTION_KIND_TO_DRAFT_TYPE[kind] as OrganizerAIDraftType };
}

interface ParsedAIDraft {
  summary: string;
  actions: Array<Record<string, unknown>>;
  warnings: string[];
}

const FEATURE = 'organizer_tournament_assistant';

@Injectable()
export class OrganizerAIAssistantService {
  private readonly logger = new Logger(OrganizerAIAssistantService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly aiUsage: AIUsageService,
    private readonly organizations: OrganizationsService,
    private readonly events: EventsService,
    private readonly phases: PhasesService,
    private readonly placement: MatchPlacementService,
    private readonly refereeBoard: AssignmentBoardService,
  ) {}

  async createDraft(eventId: string, actorUserId: string, dto: CreateOrganizerAIDraftDto) {
    const event = await this.getEvent(eventId);
    await this.organizations.assertOrgRole(event.organization_id, actorUserId, 'admin');
    await assertTournamentsBelongToEvent(this.supabase.service, eventId, [dto.tournamentId]);
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

    return this.draftView(eventId, data as DraftRow);
  }

  /**
   * Create a pending draft from already-structured write actions, all of one kind.
   * Used by the organizer chatbot (one write tool call → one draft) and by Claude
   * through the MCP server (one draft tool call → one draft of one or several
   * actions), reusing the same validation + confirm/apply lifecycle as the form
   * flow. The draft is `ready` when it validates and `failed` otherwise; the
   * organiser confirms it via `applyDraft`.
   */
  async createDraftFromAction(
    eventId: string,
    actorUserId: string,
    actions: Array<Record<string, unknown>>,
    opts: ActionDraftOptions,
  ) {
    const event = await this.getEvent(eventId);
    await this.organizations.assertOrgRole(event.organization_id, actorUserId, 'admin');

    const { kind, draftType } = draftTypeOf(actions);
    const validation = this.validateActions(draftType, actions);
    const status: DraftStatus = validation.ok ? 'ready' : 'failed';
    const tournamentId = await this.draftTournament(eventId, actions, opts.tournamentId);

    const chat = opts.source === 'chat';
    const row = {
      event_id: eventId,
      tournament_id: tournamentId,
      actor_user_id: actorUserId,
      draft_type: draftType,
      prompt: opts.prompt ?? opts.summary ?? `${chat ? 'Chatbot' : 'Claude'} proposed: ${kind}`,
      summary: opts.summary ?? null,
      proposed_actions_json: actions,
      validation_state: validation,
      status,
      error: status === 'failed' ? validation.errors.join('; ') : null,
      // Call D: a draft from Claude spends no AI usage of ours; the column keeps its default.
      ...(chat ? { ai_usage_feature: 'organizer_chat' } : {}),
      source: opts.source,
      conversation_id: opts.conversationId ?? null,
    };

    const { data, error } = await this.supabase.service
      .from('organizer_ai_assistant_drafts')
      .insert(row)
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to save draft');

    await this.audit(actorUserId, eventId, 'event.ai_assistant_draft_created', data['id'], {
      ...opts.auditExtra,
      draftType,
      status,
      source: opts.source,
      conversationId: opts.conversationId ?? null,
    });

    return this.draftView(eventId, data as DraftRow);
  }

  /**
   * The Tournament a draft from actions is about: the caller's, else its first action's. Every
   * action's own Tournament is checked as well: the ids may be the model's own tool arguments,
   * and each is checked like any caller's.
   */
  private async draftTournament(
    eventId: string,
    actions: Array<Record<string, unknown>>,
    stored: string | null | undefined,
  ): Promise<string | null> {
    const named = actions.map((action) =>
      typeof action['tournamentId'] === 'string' ? action['tournamentId'] : null,
    );
    const tournamentId = stored ?? named[0] ?? null;
    await assertTournamentsBelongToEvent(this.supabase.service, eventId, [tournamentId, ...named]);
    return tournamentId;
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
    return this.draftViews(eventId, (data ?? []) as DraftRow[]);
  }

  async getDraft(eventId: string, draftId: string, actorUserId: string) {
    const draft = await this.getDraftRow(eventId, draftId);
    await this.assertDraftAccess(draft, actorUserId);
    return this.draftView(eventId, draft);
  }

  /**
   * The Event's drafts of `ids`, by id, as `getDraft` answers each: the chat's proposals. The
   * caller has checked the actor (the chat asks org admin first, as `assertDraftAccess`).
   */
  async draftsById(eventId: string, ids: string[]) {
    const { data, error } = await this.supabase.service
      .from('organizer_ai_assistant_drafts')
      .select('*')
      .eq('event_id', eventId)
      .in('id', ids);
    if (error) throw new BadRequestException(error.message);
    const views = await this.draftViews(eventId, (data ?? []) as DraftRow[]);
    return new Map(views.map((view) => [view.id as string, view]));
  }

  async updateDraft(
    eventId: string,
    draftId: string,
    actorUserId: string,
    dto: UpdateOrganizerAIDraftDto,
  ) {
    const draft = await this.getDraftRow(eventId, draftId);
    await this.assertDraftAccess(draft, actorUserId);
    const closed = closedReason(draft);
    if (closed) throw draftClosed(closed);

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
      // The read above and this write are two requests: an Apply or a Reject in another tab
      // may close the draft between them. The write then matches no row and refuses.
      .in('status', OPEN_STATUSES)
      .is('applied_at', null)
      .select('*')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw draftClosed('This draft is already applied or rejected.');

    await this.audit(actorUserId, eventId, 'event.ai_assistant_draft_updated', draftId, {
      status: updates['status'] ?? draft.status,
      draftType: draft.draft_type,
    });

    return this.draftView(eventId, data as DraftRow);
  }

  async applyDraft(eventId: string, draftId: string, actorUserId: string) {
    const draft = await this.getDraftRow(eventId, draftId);
    await this.assertDraftAccess(draft, actorUserId);
    const closed = closedReason(draft);
    if (closed) throw draftClosed(closed);
    if (draft.status !== 'ready') throw new BadRequestException('Only ready drafts can be applied');

    const validation = this.validateActions(draft.draft_type, draft.proposed_actions_json);
    if (!validation.ok) throw new BadRequestException(validation.errors.join('; '));
    await this.assertPlacementsFit(eventId, draft);
    await this.claimDraft(draft, actorUserId);

    // NOTE: applyAction dispatches to separate services (createTournament,
    // generatePools, …) that each write via stateless PostgREST calls, so a
    // single DB transaction can't span them. Instead of leaving a mid-loop
    // failure reading 'applied' (the claim's status) or 'ready' (a retry would
    // re-apply the already-applied actions and duplicate them), we mark the
    // draft 'failed' with how far it got — an explicit, non-retryable state the
    // organizer can inspect.
    const total = draft.proposed_actions_json.length;
    const appliedResults = [];
    try {
      if (draft.draft_type === 'schedule_grid') {
        appliedResults.push(...(await this.applySchedule(eventId, draft)));
      } else {
        for (const action of draft.proposed_actions_json) {
          appliedResults.push(await this.applyAction(eventId, actorUserId, action));
        }
      }
    } catch (err) {
      const applied = appliedResults.length;
      const message = err instanceof Error ? err.message : 'unknown error';
      const { error: markError } = await this.supabase.service
        .from('organizer_ai_assistant_drafts')
        .update({
          status: 'failed',
          error: `Partially applied ${applied}/${total} action(s) before failing: ${message}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', draftId);
      // Logged, never thrown: the action's own error is the one the organiser needs.
      if (markError) {
        this.logger.error(`Draft ${draftId} not marked failed: ${markError.message}`);
      }
      await this.audit(actorUserId, eventId, 'event.ai_assistant_draft_apply_failed', draftId, {
        draftType: draft.draft_type,
        appliedCount: applied,
        totalActions: total,
        error: message,
      });
      throw err;
    }

    await this.audit(actorUserId, eventId, 'event.ai_assistant_draft_applied', draftId, {
      draftType: draft.draft_type,
      actionCount: draft.proposed_actions_json.length,
      source: draft.source ?? 'form',
      conversationId: draft.conversation_id ?? null,
    });

    return { id: draftId, status: 'applied', appliedResults };
  }

  /**
   * A schedule draft's placements, checked together before the claim and any write. Two bouts of
   * one draft on one piste at one time, or a bout on a piste the board has filled since the
   * draft, used to move the first bouts for real and fail on the next: the draft ended `failed`,
   * partly applied, and could not be applied again. Checked first, by the placement owner with
   * `checkOnly` (it writes nothing), a collision or another Event's Match refuses the Apply and
   * the draft stays `ready`, nothing moved.
   *
   * The window: the board can still change between this check and the write. The write's own
   * check (`applySchedule`) then refuses before any bout moves, and the draft is marked failed.
   */
  private async assertPlacementsFit(eventId: string, draft: DraftRow) {
    if (draft.draft_type !== 'schedule_grid') return;
    const placements = draft.proposed_actions_json.map(schedulePlacement);
    const matchIds = placements.map((placement) => placement.matchId);
    await assertMatchesBelongToEvent(this.supabase.service, eventId, matchIds);
    await this.placement.placeMatches(eventId, placements, { checkOnly: true });
  }

  /**
   * A schedule draft's placements, written in ONE call to the placement owner, as the schedule
   * board writes a batch. Marie is 30 minutes late on Piste 2 and moves M01 14:00→14:30, M02
   * 14:30→15:00 and M03 15:00→15:30. The batch check leaves every bout of the batch out by its
   * old place, so it passes; written one action at a time, M01 alone met M02, still at 14:30,
   * and the Apply failed. One call checks the batch again and then writes it whole.
   *
   * Not atomic: the owner writes row by row (`allSettled`). After its check passes, a row fails
   * only on a database error, and the owner's refusal then says "k/N placements applied" itself.
   */
  private async applySchedule(eventId: string, draft: DraftRow) {
    const placements = draft.proposed_actions_json.map(schedulePlacement);
    await this.placement.placeMatches(eventId, placements);
    return placements.map(({ matchId }) => ({ kind: 'schedule_match', result: { id: matchId } }));
  }

  /**
   * Ruling 996: a draft applies once. Marie has the page open in two tabs and presses Apply in
   * both a second apart. Both reads find the draft `ready`, so the `ready` check alone let the
   * actions run twice. The claim is one conditional write: only one Apply still finds the row
   * `ready`, and the other refuses before it runs any action.
   *
   * The claim also matches the `updated_at` the Apply read. Every edit writes `updated_at`, so
   * an edit in another tab between the read and the claim (4 Pools made 6) empties the claim:
   * the Apply refuses rather than run the 4 Pools it read under a row that says 6 ran.
   *
   * The window: the status CHECK (0031) has no in-between value, so the claim writes `applied`
   * at once. From the claim until the last action ends, the row reads `applied` while its
   * actions still run. A failed action turns it `failed` (`applyDraft`'s catch). A crash leaves
   * the row `applied` with no error: a process killed between the claim and the end, or a
   * failure write that itself fails (logged in the catch). The draft stays closed either way.
   */
  private async claimDraft(draft: DraftRow, actorUserId: string) {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase.service
      .from('organizer_ai_assistant_drafts')
      .update({
        status: 'applied',
        applied_at: now,
        applied_by_user_id: actorUserId,
        updated_at: now,
      })
      .eq('id', draft.id)
      .eq('event_id', draft.event_id)
      .eq('status', 'ready')
      .eq('updated_at', draft.updated_at)
      .select('id')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data)
      throw draftClosed(
        'This draft changed since it was opened. Reload it to see where it stands.',
      );
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
          rulesetCode: typeof action['rulesetCode'] === 'string' ? action['rulesetCode'] : 'TF_v1',
        },
        actorUserId,
      );
      return { kind, result };
    }
    if (kind === 'generate_pools') {
      await assertTournamentsBelongToEvent(this.supabase.service, eventId, [
        String(action['tournamentId']),
      ]);
      const result = await this.phases.generatePools(
        String(action['tournamentId']),
        {
          poolCount: this.optionalNumber(action['poolCount']),
          targetSize: this.optionalNumber(action['targetSize']),
          enforceSchoolSeparation: this.optionalBoolean(action['enforceSchoolSeparation']),
          enforceSkillBalance: this.optionalBoolean(action['enforceSkillBalance']),
          seed: this.optionalNumber(action['seed']),
          // NEVER read `discardScoredResults` from `action`.
          //
          // Every other field here is plumbed straight from the model's output,
          // because the worst a wrong one does is make badly-shaped pools an
          // operator can regenerate. This one is different: it accepts the
          // PERMANENT deletion of fought bouts and their exchanges. Plumbing it
          // would let a confused or prompt-injected model destroy results with
          // no human in the loop, and the failure leaves nothing to recover from.
          //
          // Hardcoded 0, so a scored phase gives the assistant the same 409
          // an operator gets. Discarding fought results stays a human decision,
          // taken on a surface where the count is on screen.
          discardScoredResults: 0,
        },
        Boolean(action['force']),
        actorUserId,
      );
      return { kind, result };
    }
    if (kind === 'generate_bracket') {
      await assertTournamentsBelongToEvent(this.supabase.service, eventId, [
        String(action['tournamentId']),
      ]);
      const bracketDto: Record<string, unknown> = {
        qualifyCount: this.optionalNumber(action['qualifyCount']),
        bracketSize: this.optionalNumber(action['bracketSize']),
        poolPhaseId: typeof action['poolPhaseId'] === 'string' ? action['poolPhaseId'] : undefined,
      };
      if (action['phaseType'] === 'double_elim' || action['phaseType'] === 'single_elim') {
        bracketDto['phaseType'] = action['phaseType'];
      }
      // The door is told who applied. `bracketDto` never carries
      // `discardScoredResults`, as for Pools above: a bracket with a fought
      // bout is refused for everybody here (ruling 284).
      const result = await this.phases.generateBracket(
        String(action['tournamentId']),
        bracketDto as never,
        Boolean(action['force']),
        actorUserId,
      );
      return { kind, result };
    }
    // `schedule_match` is not here: a schedule draft is written whole (`applySchedule`).
    if (kind === 'assign_referee')
      return { kind, result: await this.assignReferee(eventId, action) };
    throw new BadRequestException(`Unsupported draft action: ${String(kind)}`);
  }

  /**
   * `assign_referee`. The draft DSL calls the person "userId"; post-0063 it is the
   * `global_persons.id`. The row is polymorphic: exactly one of pool_id / match_id, with
   * its scope_type (0091's scope check; it failed on every apply until that was right).
   */
  private async assignReferee(eventId: string, action: Record<string, unknown>) {
    if (typeof action['poolId'] === 'string') {
      await this.assertPoolBelongsToEvent(eventId, action['poolId']);
    }
    if (typeof action['matchId'] === 'string') {
      await assertMatchesBelongToEvent(this.supabase.service, eventId, [action['matchId']]);
    }
    const poolId = typeof action['poolId'] === 'string' ? action['poolId'] : null;
    const matchId = typeof action['matchId'] === 'string' ? action['matchId'] : null;
    if ((poolId === null) === (matchId === null)) {
      throw new BadRequestException(
        'A referee assignment must name exactly one of poolId or matchId',
      );
    }

    // The one referee checker (ADR-016), and the assistant never confirms (W1 ruling 3):
    // Impossible and Discouraged are both refused, and the organiser assigns by hand to
    // go ahead. The refusal's message names each reason: it is all the failed draft keeps.
    await assertRefereeBoardUnlocked(this.supabase.service, eventId);
    const personId = String(action['userId']);
    const role = String(action['role']);
    const { stored } = await this.refereeBoard.judgeWrite(
      eventId,
      poolId
        ? { poolId, role, personId, confirm: false }
        : { matchIds: [matchId as string], role, personId, confirm: false },
    );

    const { data, error } = await this.supabase.service
      .from('referee_assignments')
      .insert({
        event_id: eventId,
        person_id: personId,
        scope_type: matchId ? 'match' : 'pool',
        lice_id: null,
        pool_id: poolId,
        match_id: matchId,
        role,
        status: 'assigned',
        auto_assigned: false,
        conflicts_jsonb: stored,
      })
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
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

  /**
   * The action contract, in the words the model actually sees.
   *
   * Deliberately adjacent to `validateActionShape` below: that method is the
   * enforcement, this is the ONLY description the model ever gets, and when the
   * two disagree the model cannot win — it emits what it was told and the draft
   * fails validation.
   *
   * Which is exactly what happened. Until this existed the prompt said only
   * "return JSON with keys: summary, actions, warnings" and never mentioned
   * `kind` or any field, so the model had to guess a schema it had never been
   * shown. Every `tournament_config` draft came back
   * `Unsupported draft action: undefined`. The code-fence defect had been
   * masking this one: fix the parser and the drafts merely failed one step
   * later.
   *
   * Keep in step with `validateActionShape` and `applyAction`.
   */
  private static readonly ACTION_CONTRACT: Record<OrganizerAIDraftType, string> = {
    tournament_config:
      '{"kind":"create_tournament","name":<string>,"slug":<lowercase-hyphenated string>,' +
      '"weapon":<string, optional>,"rulesetCode":<string, optional, default "TF_v1">}',
    pool_plan:
      '{"kind":"generate_pools","tournamentId":<string>, plus at least one of ' +
      '"poolCount":<number> or "targetSize":<number>; optional ' +
      '"enforceSchoolSeparation":<boolean>,"enforceSkillBalance":<boolean>,"seed":<number>}',
    bracket_plan:
      '{"kind":"generate_bracket","tournamentId":<string>; optional ' +
      '"phaseType":"single_elim"|"double_elim","qualifyCount":<number>,' +
      '"bracketSize":<number>,"poolPhaseId":<string>}',
    schedule_grid:
      '{"kind":"schedule_match","matchId":<string>,"liceId":<string>,' +
      '"scheduledAt":<ISO-8601 timestamp>}',
    referee_assignments:
      '{"kind":"assign_referee","userId":<person id>,"role":<string>, plus exactly one of ' +
      '"poolId":<string> or "matchId":<string>}',
  };

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
    // Tolerant of the code fence models add even when told not to. A bare
    // JSON.parse here meant every draft landed `failed` with no actions — see
    // `common/model-json.ts`.
    const parsed = parseModelJson<Partial<ParsedAIDraft>>(text);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    if (!Array.isArray(parsed.value.actions)) {
      return { ok: false, error: 'Missing actions array' };
    }
    return {
      ok: true,
      value: {
        summary: typeof parsed.value.summary === 'string' ? parsed.value.summary : '',
        actions: parsed.value.actions,
        warnings: Array.isArray(parsed.value.warnings)
          ? parsed.value.warnings.filter(
              (warning): warning is string => typeof warning === 'string',
            )
          : [],
      },
    };
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
      .from('organization_ai_keys')
      .select('id')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('No AI provider configured for this organization');
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
      // Belt to the parser's braces: `parseModelJson` strips a fence anyway,
      // but asking lowers the rate rather than relying wholly on recovery.
      'Output the raw JSON object only — no markdown code fence, no prose around it.',
      'Never invent IDs. Use IDs present in the organizer context.',
      `Draft type: ${draftType}.`,
      // Without this the model has to guess a schema it has never been shown,
      // and every draft failed validation on `kind`. See ACTION_CONTRACT.
      `Every entry of "actions" must match exactly this shape for this draft type: ${
        OrganizerAIAssistantService.ACTION_CONTRACT[draftType]
      }`,
      'Emit no other action kind — a draft containing anything else is rejected whole.',
    ].join('\n');
  }

  private userPrompt(event: EventRow, dto: CreateOrganizerAIDraftDto) {
    return JSON.stringify({
      event: { id: event.id, name: event.name ?? null },
      tournamentId: dto.tournamentId ?? null,
      organizerPrompt: dto.prompt,
    });
  }

  /**
   * The drafts as the API answers them: each row's fields, and its actions by name beside the
   * raw ones (call U). One batched read per kind of id for all the drafts, not one per draft.
   */
  private async draftViews(eventId: string, rows: DraftRow[]) {
    const readable = await readableDraftActions(
      this.supabase.service,
      eventId,
      rows.map((row) => row.proposed_actions_json),
    );
    return rows.map((row, index) => ({ ...this.mapDraft(row), readable: readable[index]! }));
  }

  private async draftView(eventId: string, row: DraftRow) {
    return (await this.draftViews(eventId, [row]))[0]!;
  }

  private mapDraft(row: DraftRow) {
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
      applyStarted: applyStarted(row),
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
    await insertAuditLog(this.supabase.service, {
      actorUserId,
      action,
      entityType: 'organizer_ai_assistant_draft',
      entityId: String(draftId),
      payload,
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
