import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';
import type {
  ChatMessage,
  GenerationRequest,
  GenerationResult,
  GenerationStopReason,
  ProviderAdapter,
  ToolCall,
  ToolDefinition,
} from './provider-adapter.interface';
import { findModel, getDefaultModel, type ModelInfo } from '../model-registry';

/**
 * Added to `max_tokens` on a model that cannot turn thinking off. It is a cap, not a charge:
 * only the tokens the model writes are billed.
 */
export const ALWAYS_ON_THINKING_HEADROOM = 4096;

/** The request fields that keep thinking out of the reply (see `ModelInfo.anthropicThinking`). */
function thinkingFields(
  model: ModelInfo | undefined,
): Pick<Anthropic.MessageCreateParamsNonStreaming, 'thinking' | 'output_config'> {
  switch (model?.anthropicThinking) {
    case 'disabled':
      return { thinking: { type: 'disabled' } };
    case 'between_tools':
      return { thinking: { type: 'between_tools' } };
    case 'always_on':
      return { output_config: { effort: 'low' } };
    case undefined:
      return {};
  }
}

function mapTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool['input_schema'],
  }));
}

/** Map our provider-neutral transcript to Anthropic message params. */
function mapMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  return messages.map((m): Anthropic.MessageParam => {
    if (m.role === 'tool') {
      // Anthropic represents tool results as a user turn of tool_result blocks.
      return {
        role: 'user',
        content: (m.toolResults ?? []).map((r) => ({
          type: 'tool_result' as const,
          tool_use_id: r.toolCallId,
          content: r.content,
          ...(r.isError ? { is_error: true } : {}),
        })),
      };
    }
    if (m.role === 'assistant') {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
      }
      return { role: 'assistant', content: blocks.length ? blocks : (m.content ?? '') };
    }
    return { role: 'user', content: m.content ?? '' };
  });
}

function mapStopReason(r: string | null | undefined): GenerationStopReason {
  if (r === 'end_turn' || r === 'tool_use' || r === 'max_tokens' || r === 'refusal') return r;
  return 'other';
}

/**
 * A new client per call: the key changes with each call (an organisation's, a fighter's or the
 * platform's), and the SDK takes `fetch` when it is built, so a cached client would also escape
 * the wire tests' recorder. From 0.134 on, the SDK traces by itself through whatever global
 * OpenTelemetry tracer and propagator are registered: spans, and trace headers sent to
 * Anthropic. Sentry 11 registers neither unless `enableOpenTelemetrySetup` is on, so today it is
 * inert; `openTelemetry: false` keeps it off whatever gets registered later.
 */
function createClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, openTelemetry: false });
}

/**
 * No `temperature`, on any model: API version 2026-10-21 (SDK 1.x) answers 400 to temperature,
 * top_p or top_k on every model. `request.temperature` is for the other providers.
 */
function buildParams(
  request: GenerationRequest,
  model: ModelInfo | undefined,
): Anthropic.MessageCreateParamsNonStreaming {
  const forceTool = request.toolChoice === 'required' && !model?.rejectsForcedToolChoice;
  return {
    model: request.model,
    max_tokens:
      request.maxTokens +
      (model?.anthropicThinking === 'always_on' ? ALWAYS_ON_THINKING_HEADROOM : 0),
    system: request.system,
    messages: request.messages
      ? mapMessages(request.messages)
      : [{ role: 'user', content: request.user ?? '' }],
    ...thinkingFields(model),
    ...(request.tools?.length
      ? {
          tools: mapTools(request.tools),
          tool_choice: forceTool ? { type: 'any' as const } : { type: 'auto' as const },
        }
      : {}),
  };
}

@Injectable()
export class AnthropicAdapter implements ProviderAdapter {
  async generate(apiKey: string, request: GenerationRequest): Promise<GenerationResult> {
    const client = createClient(apiKey);
    const model = findModel('anthropic', request.model);
    const response = await client.messages.create(buildParams(request, model));

    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
    const text = textBlocks.map((b) => b.text).join('');

    const toolCalls: ToolCall[] = response.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, arguments: b.input as Record<string, unknown> }));
    const toolCall = toolCalls[0]
      ? { name: toolCalls[0].name, arguments: toolCalls[0].arguments }
      : undefined;

    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const pricing = (model ?? getDefaultModel('anthropic')).pricing;
    const costEur = inputTokens * pricing.input + outputTokens * pricing.output;

    return {
      text,
      toolCall,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      stopReason: mapStopReason(response.stop_reason),
      inputTokens,
      outputTokens,
      costEur,
    };
  }

  async listModels(apiKey: string): Promise<string[]> {
    const client = createClient(apiKey);
    const ids: string[] = [];
    for await (const m of client.models.list()) ids.push(m.id);
    return ids;
  }
}
