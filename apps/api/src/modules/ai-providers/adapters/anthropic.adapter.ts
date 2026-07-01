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
import { findModel, getDefaultModel } from '../model-registry';

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

@Injectable()
export class AnthropicAdapter implements ProviderAdapter {
  async generate(apiKey: string, request: GenerationRequest): Promise<GenerationResult> {
    const client = new Anthropic({ apiKey });
    // Opus 4.7/4.8 reject `temperature` with a 400 — omit it per the registry
    // capability flag rather than sending it unconditionally.
    const model = findModel('anthropic', request.model);
    const supportsTemperature = model?.supportsTemperature ?? true;
    const messages: Anthropic.MessageParam[] = request.messages
      ? mapMessages(request.messages)
      : [{ role: 'user', content: request.user ?? '' }];
    const response = await client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens,
      ...(supportsTemperature ? { temperature: request.temperature } : {}),
      system: request.system,
      messages,
      ...(request.tools?.length
        ? {
            tools: mapTools(request.tools),
            tool_choice:
              request.toolChoice === 'required'
                ? { type: 'any' as const }
                : { type: 'auto' as const },
          }
        : {}),
    });

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
    const client = new Anthropic({ apiKey });
    const ids: string[] = [];
    for await (const m of client.models.list()) ids.push(m.id);
    return ids;
  }
}
