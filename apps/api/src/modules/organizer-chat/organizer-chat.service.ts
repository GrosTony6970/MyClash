import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  ChatMessage,
  ToolCall,
  ToolResultPart,
} from '../ai-providers/adapters/provider-adapter.interface';
import { AIUsageService } from '../ai-usage/ai-usage.service';
import { AdminFeatureFlagsService } from '../admin/admin-feature-flags.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { OrganizerAIAssistantService } from '../organizer-ai-assistant/organizer-ai-assistant.service';
import { SupabaseService } from '../supabase/supabase.service';
import { ORGANIZER_CHAT_TOOLS, isWriteTool } from './organizer-chat.tools';
import { OrganizerChatToolsService } from './organizer-chat.tools.service';
import { trimTranscript } from './organizer-chat.transcript';

const FEATURE = 'organizer_chat';
const MAX_TURNS = 6;
const MAX_TOKENS = 1500;
const TEMPERATURE = 0.3;

/**
 * Turn-level progress events for the streaming chat endpoint. The loop is not
 * token-streamed (each turn calls the provider normally); instead we surface
 * what the assistant is doing between turns so the UI isn't a silent wait and
 * the SSE connection stays alive during a long multi-turn run.
 */
export type ChatStreamEvent =
  | { type: 'status'; phase: 'thinking' }
  | { type: 'tool'; name: string }
  | { type: 'proposal'; draftId: string }
  | { type: 'assistant'; content: string }
  | { type: 'notice'; content: string };

interface EventRow {
  id: string;
  organization_id: string;
  name?: string | null;
}

interface ConversationRow {
  id: string;
  event_id: string;
  organization_id: string;
  tournament_id?: string | null;
  created_by_user_id: string;
  title?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls_json?: ToolCall[] | null;
  tool_results_json?: ToolResultPart[] | null;
  proposed_draft_id?: string | null;
  cost_eur?: number | null;
  created_at?: string;
}

@Injectable()
export class OrganizerChatService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly aiUsage: AIUsageService,
    private readonly organizations: OrganizationsService,
    private readonly assistant: OrganizerAIAssistantService,
    private readonly tools: OrganizerChatToolsService,
    private readonly flags: AdminFeatureFlagsService,
  ) {}

  async createConversation(
    eventId: string,
    userId: string,
    dto: { tournamentId?: string | null; title?: string | null },
  ) {
    const event = await this.assertOrgAccess(eventId, userId);
    const { data, error } = await this.supabase.service
      .from('organizer_chat_conversations')
      .insert({
        event_id: eventId,
        organization_id: event.organization_id,
        tournament_id: dto.tournamentId ?? null,
        created_by_user_id: userId,
        title: dto.title ?? null,
      })
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to create chat');
    return this.view(data as ConversationRow, []);
  }

  async listConversations(eventId: string, userId: string) {
    await this.assertOrgAccess(eventId, userId);
    const { data, error } = await this.supabase.service
      .from('organizer_chat_conversations')
      .select('*')
      .eq('event_id', eventId)
      .order('updated_at', { ascending: false })
      .limit(50);
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as ConversationRow[]).map((row) => ({
      id: row.id,
      eventId: row.event_id,
      tournamentId: row.tournament_id ?? null,
      title: row.title ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async getConversation(eventId: string, conversationId: string, userId: string) {
    await this.assertOrgAccess(eventId, userId);
    const conversation = await this.loadConversation(eventId, conversationId);
    const messages = await this.loadMessages(conversationId);
    return this.view(conversation, messages);
  }

  async renameConversation(eventId: string, conversationId: string, userId: string, title: string) {
    await this.assertOrgAccess(eventId, userId);
    await this.loadConversation(eventId, conversationId);
    const { data, error } = await this.supabase.service
      .from('organizer_chat_conversations')
      .update({ title: title.trim(), updated_at: new Date().toISOString() })
      .eq('id', conversationId)
      .eq('event_id', eventId)
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to rename chat');
    const messages = await this.loadMessages(conversationId);
    return this.view(data as ConversationRow, messages);
  }

  async deleteConversation(eventId: string, conversationId: string, userId: string) {
    await this.assertOrgAccess(eventId, userId);
    await this.loadConversation(eventId, conversationId);
    // Messages cascade-delete (0116 FK); linked drafts keep their audit trail
    // with conversation_id nulled (ON DELETE SET NULL).
    const { error } = await this.supabase.service
      .from('organizer_chat_conversations')
      .delete()
      .eq('id', conversationId)
      .eq('event_id', eventId);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true, id: conversationId };
  }

  async sendMessage(
    eventId: string,
    conversationId: string,
    userId: string,
    content: string,
    onEvent?: (e: ChatStreamEvent) => void,
  ) {
    const event = await this.assertOrgAccess(eventId, userId);
    await this.assertChatEnabled(event.organization_id);
    await this.assertAIConfigured(event.organization_id);
    await this.loadConversation(eventId, conversationId); // 404s if it doesn't exist

    const history = await this.loadMessages(conversationId);
    const transcript: ChatMessage[] = history.map((m) => this.toChatMessage(m));

    // Persist + append the user turn.
    await this.insertMessage(conversationId, { role: 'user', content });
    transcript.push({ role: 'user', content });

    let proposedDraftId: string | null = null;
    for (let turn = 0; turn < MAX_TURNS && !proposedDraftId; turn++) {
      onEvent?.({ type: 'status', phase: 'thinking' });
      let result;
      try {
        result = await this.aiUsage.generateWithCap(event.organization_id, eventId, FEATURE, {
          system: this.systemPrompt(),
          messages: trimTranscript(transcript),
          model: 'default',
          maxTokens: MAX_TOKENS,
          temperature: TEMPERATURE,
          tools: ORGANIZER_CHAT_TOOLS,
          toolChoice: 'auto',
        });
      } catch (e) {
        // Spend cap / kill-switch / provider error — end the turn gracefully.
        const note =
          e instanceof ServiceUnavailableException
            ? 'AI features are currently disabled.'
            : e instanceof Error && e.name === 'SpendCapExceededException'
              ? 'The AI spend cap for this event has been reached.'
              : 'The assistant could not complete this request right now.';
        await this.insertMessage(conversationId, { role: 'assistant', content: note });
        onEvent?.({ type: 'notice', content: note });
        break;
      }

      const toolCalls = result.toolCalls ?? [];
      if (toolCalls.length === 0) {
        await this.insertMessage(conversationId, {
          role: 'assistant',
          content: result.text,
          costEur: result.costEur,
        });
        onEvent?.({ type: 'assistant', content: result.text });
        break;
      }

      // Resolve every tool call (reads run; the first write becomes a proposal).
      const toolResults: ToolResultPart[] = [];
      let draftIdThisTurn: string | null = null;
      for (const call of toolCalls) {
        if (isWriteTool(call.name)) {
          if (draftIdThisTurn) {
            toolResults.push({
              toolCallId: call.id,
              content: 'Skipped: only one action can be proposed per message.',
            });
            continue;
          }
          const draft = await this.proposeWrite(eventId, userId, conversationId, call, result.text);
          draftIdThisTurn = draft.id as string;
          onEvent?.({ type: 'proposal', draftId: draft.id as string });
          toolResults.push({
            toolCallId: call.id,
            content: `Proposed to the organizer for confirmation (draft ${draft.id}). Await their decision before proposing anything else.`,
          });
        } else {
          onEvent?.({ type: 'tool', name: call.name });
          const out = await this.tools.executeRead(eventId, call.name, call.arguments);
          toolResults.push({ toolCallId: call.id, content: JSON.stringify(out) });
        }
      }

      // Persist the assistant turn (with its tool calls) and the tool results.
      const assistantMsg = await this.insertMessage(conversationId, {
        role: 'assistant',
        content: result.text,
        toolCalls,
        costEur: result.costEur,
        proposedDraftId: draftIdThisTurn,
      });
      await this.insertMessage(conversationId, { role: 'tool', toolResults });

      transcript.push({ role: 'assistant', content: result.text, toolCalls });
      transcript.push({ role: 'tool', toolResults });
      void assistantMsg;
      proposedDraftId = draftIdThisTurn;
    }

    await this.touchConversation(conversationId);
    return this.getConversation(eventId, conversationId, userId);
  }

  async confirmProposal(eventId: string, conversationId: string, draftId: string, userId: string) {
    await this.assertOrgAccess(eventId, userId);
    await this.loadConversation(eventId, conversationId);
    await this.assertDraftInConversation(conversationId, draftId);
    const applied = await this.assistant.applyDraft(eventId, draftId, userId);
    await this.insertMessage(conversationId, {
      role: 'assistant',
      content: 'Done — the proposed action was applied.',
    });
    await this.touchConversation(conversationId);
    return { applied, conversation: await this.getConversation(eventId, conversationId, userId) };
  }

  async rejectProposal(eventId: string, conversationId: string, draftId: string, userId: string) {
    await this.assertOrgAccess(eventId, userId);
    await this.loadConversation(eventId, conversationId);
    await this.assertDraftInConversation(conversationId, draftId);
    await this.assistant.updateDraft(eventId, draftId, userId, { status: 'rejected' });
    await this.insertMessage(conversationId, {
      role: 'assistant',
      content: 'The proposed action was dismissed.',
    });
    await this.touchConversation(conversationId);
    return this.getConversation(eventId, conversationId, userId);
  }

  // ── internals ───────────────────────────────────────────────────────────────

  private async proposeWrite(
    eventId: string,
    userId: string,
    conversationId: string,
    call: ToolCall,
    summary: string,
  ) {
    const action = { kind: call.name, ...call.arguments };
    return this.assistant.createDraftFromAction(eventId, userId, action, {
      conversationId,
      summary: summary || undefined,
      tournamentId:
        typeof call.arguments['tournamentId'] === 'string'
          ? (call.arguments['tournamentId'] as string)
          : null,
    });
  }

  private toChatMessage(m: MessageRow): ChatMessage {
    if (m.role === 'tool') {
      return { role: 'tool', toolResults: m.tool_results_json ?? [] };
    }
    if (m.role === 'assistant') {
      return {
        role: 'assistant',
        content: m.content ?? '',
        ...(m.tool_calls_json?.length ? { toolCalls: m.tool_calls_json } : {}),
      };
    }
    return { role: 'user', content: m.content ?? '' };
  }

  private systemPrompt(): string {
    return [
      'You are the MyClash organizer assistant for a HEMA tournament event.',
      'You answer questions about the event and its tournaments, and you can propose setup actions.',
      'Use the read tools freely to ground every answer in real data. Call list_tournaments first to get tournament ids; never invent ids.',
      'To perform an action (create a tournament, generate pools or a bracket, schedule a match, assign a referee), call the matching write tool. Write tools do NOT execute immediately — they are proposed to the organizer, who must confirm. Briefly explain what you are proposing.',
      'Propose one action at a time. After proposing, stop and wait for the organizer to confirm before proposing anything else.',
      'When assigning a referee, use the person id from list_referees as userId.',
      "Be concise and answer in the organizer's language.",
    ].join('\n');
  }

  private async assertOrgAccess(eventId: string, userId: string): Promise<EventRow> {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('id, organization_id, name')
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Event ${eventId} not found`);
    const event = data as EventRow;
    await this.organizations.assertOrgRole(event.organization_id, userId, 'admin');
    return event;
  }

  private async assertChatEnabled(orgId: string): Promise<void> {
    if (await this.flags.isEnabled('disable_organizer_chat')) {
      throw new ServiceUnavailableException('The organizer chatbot is currently disabled');
    }
    // Per-org override: an org can turn the chatbot off for itself even when the
    // platform flag is on (org can only further restrict, never bypass a global
    // kill-switch). generateWithCap already enforces the org-level AI disable.
    const { data } = await this.supabase.service
      .from('organization_ai_settings')
      .select('organizer_chat_disabled')
      .eq('organization_id', orgId)
      .maybeSingle();
    if ((data as { organizer_chat_disabled?: boolean } | null)?.organizer_chat_disabled) {
      throw new ServiceUnavailableException(
        'The organizer chatbot is disabled for this organization',
      );
    }
  }

  private async assertAIConfigured(orgId: string): Promise<void> {
    const { data, error } = await this.supabase.service
      .from('organization_ai_keys')
      .select('id')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('No AI provider configured for this organization');
  }

  private async loadConversation(
    eventId: string,
    conversationId: string,
  ): Promise<ConversationRow> {
    const { data, error } = await this.supabase.service
      .from('organizer_chat_conversations')
      .select('*')
      .eq('id', conversationId)
      .eq('event_id', eventId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Conversation ${conversationId} not found`);
    return data as ConversationRow;
  }

  private async loadMessages(conversationId: string): Promise<MessageRow[]> {
    const { data, error } = await this.supabase.service
      .from('organizer_chat_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as MessageRow[];
  }

  private async insertMessage(
    conversationId: string,
    msg: {
      role: 'user' | 'assistant' | 'tool';
      content?: string;
      toolCalls?: ToolCall[];
      toolResults?: ToolResultPart[];
      proposedDraftId?: string | null;
      costEur?: number;
    },
  ): Promise<MessageRow> {
    const { data, error } = await this.supabase.service
      .from('organizer_chat_messages')
      .insert({
        conversation_id: conversationId,
        role: msg.role,
        content: msg.content ?? null,
        tool_calls_json: msg.toolCalls ?? [],
        tool_results_json: msg.toolResults ?? [],
        proposed_draft_id: msg.proposedDraftId ?? null,
        cost_eur: msg.costEur ?? 0,
      })
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to store message');
    return data as MessageRow;
  }

  private async touchConversation(conversationId: string): Promise<void> {
    await this.supabase.service
      .from('organizer_chat_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);
  }

  private async assertDraftInConversation(conversationId: string, draftId: string): Promise<void> {
    const { data, error } = await this.supabase.service
      .from('organizer_ai_assistant_drafts')
      .select('id, conversation_id')
      .eq('id', draftId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    const row = data as { conversation_id?: string | null } | null;
    if (!row || row.conversation_id !== conversationId) {
      throw new BadRequestException('Proposal does not belong to this conversation');
    }
  }

  private async view(conversation: ConversationRow, messages: MessageRow[]) {
    const draftIds = messages
      .map((m) => m.proposed_draft_id)
      .filter((v): v is string => typeof v === 'string');
    const drafts = draftIds.length ? await this.loadDrafts(draftIds) : new Map();

    return {
      id: conversation.id,
      eventId: conversation.event_id,
      tournamentId: conversation.tournament_id ?? null,
      title: conversation.title ?? null,
      messages: messages
        .filter((m) => m.role !== 'tool')
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content ?? '',
          toolCalls: (m.tool_calls_json ?? []).map((c) => ({ name: c.name })),
          proposal: m.proposed_draft_id ? (drafts.get(m.proposed_draft_id) ?? null) : null,
          createdAt: m.created_at,
        })),
    };
  }

  private async loadDrafts(ids: string[]) {
    const { data } = await this.supabase.service
      .from('organizer_ai_assistant_drafts')
      .select('id, draft_type, status, summary, proposed_actions_json, validation_state')
      .in('id', ids);
    const map = new Map<string, unknown>();
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      map.set(String(row['id']), {
        id: row['id'],
        draftType: row['draft_type'],
        status: row['status'],
        summary: row['summary'] ?? null,
        proposedActions: row['proposed_actions_json'] ?? [],
        validationState: row['validation_state'] ?? { ok: false, warnings: [], errors: [] },
      });
    }
    return map;
  }
}
