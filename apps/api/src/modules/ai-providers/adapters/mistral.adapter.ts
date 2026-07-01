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

// @mistralai/mistralai is an ESM-only package; under moduleResolution: "node16"
// a CommonJS file can't statically `import` from it. Load it lazily via a
// dynamic import inside `generate()` so the CJS host code keeps working while
// Node resolves the ESM module at call time.

function mapTools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

// Loose message shape — the Mistral SDK is dynamically imported so its strict
// message union isn't available at compile time; we build well-formed objects
// and cast at the call site.
type MistralMsg =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      toolCalls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
    }
  | { role: 'tool'; toolCallId: string; content: string };

function mapMessages(system: string, messages: ChatMessage[]): MistralMsg[] {
  const out: MistralMsg[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'tool') {
      for (const r of m.toolResults ?? []) {
        out.push({ role: 'tool', toolCallId: r.toolCallId, content: r.content });
      }
    } else if (m.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: m.content ?? '',
        ...(m.toolCalls?.length
          ? {
              toolCalls: m.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
              })),
            }
          : {}),
      });
    } else {
      out.push({ role: 'user', content: m.content ?? '' });
    }
  }
  return out;
}

function mapStopReason(r: string | null | undefined): GenerationStopReason {
  if (r === 'stop') return 'end_turn';
  if (r === 'tool_calls') return 'tool_use';
  if (r === 'length' || r === 'model_length') return 'max_tokens';
  return 'other';
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return (raw as Record<string, unknown>) ?? {};
}

@Injectable()
export class MistralAdapter implements ProviderAdapter {
  async generate(apiKey: string, request: GenerationRequest): Promise<GenerationResult> {
    const { Mistral } = await import('@mistralai/mistralai');
    const client = new Mistral({ apiKey });
    const model = findModel('mistral', request.model);
    const supportsTemperature = model?.supportsTemperature ?? true;
    const messages: MistralMsg[] = request.messages
      ? mapMessages(request.system, request.messages)
      : [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user ?? '' },
        ];
    const response = await client.chat.complete({
      model: request.model,
      maxTokens: request.maxTokens,
      ...(supportsTemperature ? { temperature: request.temperature } : {}),
      messages: messages as never,
      ...(request.tools?.length
        ? {
            tools: mapTools(request.tools),
            toolChoice: request.toolChoice === 'required' ? 'required' : 'auto',
          }
        : {}),
    });

    const choice = response?.choices?.[0];
    const text = typeof choice?.message?.content === 'string' ? choice.message.content : '';

    const toolCalls: ToolCall[] = (choice?.message?.toolCalls ?? []).map((tc, i) => ({
      id: tc.id ?? `call_${i}`,
      name: tc.function.name,
      arguments: parseArgs(tc.function.arguments),
    }));
    const toolCall = toolCalls[0]
      ? { name: toolCalls[0].name, arguments: toolCalls[0].arguments }
      : undefined;

    const inputTokens = response?.usage?.promptTokens ?? 0;
    const outputTokens = response?.usage?.completionTokens ?? 0;
    const pricing = (model ?? getDefaultModel('mistral')).pricing;
    const costEur = inputTokens * pricing.input + outputTokens * pricing.output;

    return {
      text,
      toolCall,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      stopReason: mapStopReason(choice?.finishReason),
      inputTokens,
      outputTokens,
      costEur,
    };
  }

  async listModels(apiKey: string): Promise<string[]> {
    const { Mistral } = await import('@mistralai/mistralai');
    const client = new Mistral({ apiKey });
    const res = await client.models.list();
    return (res?.data ?? [])
      .map((m) => (m as { id?: string }).id)
      .filter((id): id is string => Boolean(id));
  }
}
