import OpenAI from 'openai';
import type { ChatCompletionMessageFunctionToolCall } from 'openai/resources/chat/completions/completions';
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

function mapTools(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

function mapMessages(system: string, messages: ChatMessage[]): OpenAI.ChatCompletionMessageParam[] {
  const out: OpenAI.ChatCompletionMessageParam[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'tool') {
      for (const r of m.toolResults ?? []) {
        out.push({ role: 'tool', tool_call_id: r.toolCallId, content: r.content });
      }
    } else if (m.role === 'assistant') {
      if (m.toolCalls?.length) {
        out.push({
          role: 'assistant',
          content: m.content ?? null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        });
      } else {
        out.push({ role: 'assistant', content: m.content ?? '' });
      }
    } else {
      out.push({ role: 'user', content: m.content ?? '' });
    }
  }
  return out;
}

function mapStopReason(r: string | null | undefined): GenerationStopReason {
  if (r === 'stop') return 'end_turn';
  if (r === 'tool_calls' || r === 'function_call') return 'tool_use';
  if (r === 'length') return 'max_tokens';
  if (r === 'content_filter') return 'refusal';
  return 'other';
}

@Injectable()
export class OpenAIAdapter implements ProviderAdapter {
  async generate(apiKey: string, request: GenerationRequest): Promise<GenerationResult> {
    const client = new OpenAI({ apiKey });
    const model = findModel('openai', request.model);
    const supportsTemperature = model?.supportsTemperature ?? true;
    const messages: OpenAI.ChatCompletionMessageParam[] = request.messages
      ? mapMessages(request.system, request.messages)
      : [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user ?? '' },
        ];
    const response = await client.chat.completions.create({
      model: request.model,
      max_tokens: request.maxTokens,
      ...(supportsTemperature ? { temperature: request.temperature } : {}),
      messages,
      ...(request.tools?.length
        ? {
            tools: mapTools(request.tools),
            tool_choice: request.toolChoice === 'required' ? 'required' : 'auto',
          }
        : {}),
    });

    const choice = response.choices[0];
    const text = choice?.message?.content ?? '';

    const toolCalls: ToolCall[] = [];
    for (const entry of choice?.message?.tool_calls ?? []) {
      if ('function' in entry) {
        const fn = (entry as ChatCompletionMessageFunctionToolCall).function;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(fn.arguments) as Record<string, unknown>;
        } catch {
          args = {};
        }
        toolCalls.push({ id: entry.id, name: fn.name, arguments: args });
      }
    }
    const toolCall = toolCalls[0]
      ? { name: toolCalls[0].name, arguments: toolCalls[0].arguments }
      : undefined;

    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    const pricing = (model ?? getDefaultModel('openai')).pricing;
    const costEur = inputTokens * pricing.input + outputTokens * pricing.output;

    return {
      text,
      toolCall,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      stopReason: mapStopReason(choice?.finish_reason),
      inputTokens,
      outputTokens,
      costEur,
    };
  }

  async listModels(apiKey: string): Promise<string[]> {
    const client = new OpenAI({ apiKey });
    const ids: string[] = [];
    for await (const m of client.models.list()) ids.push(m.id);
    return ids;
  }
}
