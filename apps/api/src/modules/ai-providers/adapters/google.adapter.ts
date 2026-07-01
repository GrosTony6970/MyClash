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

// @google/genai is an ESM-only package; under moduleResolution: "node16" a
// CommonJS file can't statically `import` from it. Load it lazily via a dynamic
// import inside the methods (same pattern as the Mistral adapter).

function mapTools(tools: ToolDefinition[]) {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    },
  ];
}

// Loose Gemini content shapes — the SDK is dynamically imported so its strict
// unions aren't available; we build well-formed objects and cast at the call site.
type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };
type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] };

/** Gemini's functionResponse wants a struct; wrap non-object tool output. */
function parseToolResult(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { result: parsed };
  } catch {
    return { result: content };
  }
}

function mapMessages(messages: ChatMessage[]): GeminiContent[] {
  // Gemini correlates tool results to calls by function *name*, not id, so build
  // a toolCallId → name map from the assistant turns first.
  const nameById = new Map<string, string>();
  for (const m of messages) {
    if (m.role === 'assistant') {
      for (const tc of m.toolCalls ?? []) nameById.set(tc.id, tc.name);
    }
  }
  const out: GeminiContent[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      out.push({
        role: 'user',
        parts: (m.toolResults ?? []).map((r) => ({
          functionResponse: {
            name: nameById.get(r.toolCallId) ?? r.toolCallId,
            response: parseToolResult(r.content),
          },
        })),
      });
    } else if (m.role === 'assistant') {
      const parts: GeminiPart[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.toolCalls ?? []) {
        parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
      }
      out.push({ role: 'model', parts: parts.length ? parts : [{ text: '' }] });
    } else {
      out.push({ role: 'user', parts: [{ text: m.content ?? '' }] });
    }
  }
  return out;
}

function mapStopReason(r: string | null | undefined, hasToolCalls: boolean): GenerationStopReason {
  // Gemini reports finishReason STOP even when it emits function calls, so the
  // presence of tool calls decides `tool_use` rather than the finish reason.
  if (hasToolCalls) return 'tool_use';
  if (r === 'STOP') return 'end_turn';
  if (r === 'MAX_TOKENS') return 'max_tokens';
  if (r === 'SAFETY' || r === 'PROHIBITED_CONTENT' || r === 'BLOCKLIST') return 'refusal';
  return 'other';
}

@Injectable()
export class GoogleAdapter implements ProviderAdapter {
  async generate(apiKey: string, request: GenerationRequest): Promise<GenerationResult> {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    const model = findModel('google', request.model);
    const supportsTemperature = model?.supportsTemperature ?? true;

    const contents: GeminiContent[] = request.messages
      ? mapMessages(request.messages)
      : [{ role: 'user', parts: [{ text: request.user ?? '' }] }];

    const config: Record<string, unknown> = {
      systemInstruction: request.system,
      maxOutputTokens: request.maxTokens,
      ...(supportsTemperature ? { temperature: request.temperature } : {}),
      ...(request.tools?.length
        ? {
            tools: mapTools(request.tools),
            toolConfig: {
              functionCallingConfig: {
                mode: request.toolChoice === 'required' ? 'ANY' : 'AUTO',
              },
            },
          }
        : {}),
    };

    const response = await ai.models.generateContent({
      model: request.model,
      contents: contents as never,
      config: config as never,
    });

    const text = response.text ?? '';
    const toolCalls: ToolCall[] = (response.functionCalls ?? []).map((c, i) => ({
      id: c.id ?? `call_${i}`,
      name: c.name ?? '',
      arguments: (c.args ?? {}) as Record<string, unknown>,
    }));
    const toolCall = toolCalls[0]
      ? { name: toolCalls[0].name, arguments: toolCalls[0].arguments }
      : undefined;

    const usage = response.usageMetadata;
    const inputTokens = usage?.promptTokenCount ?? 0;
    const outputTokens = usage?.candidatesTokenCount ?? 0;
    const pricing = (model ?? getDefaultModel('google')).pricing;
    const costEur = inputTokens * pricing.input + outputTokens * pricing.output;

    return {
      text,
      toolCall,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      stopReason: mapStopReason(response.candidates?.[0]?.finishReason, toolCalls.length > 0),
      inputTokens,
      outputTokens,
      costEur,
    };
  }

  async listModels(apiKey: string): Promise<string[]> {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    const ids: string[] = [];
    const pager = await ai.models.list();
    for await (const m of pager) {
      const name = (m.name ?? '').replace(/^models\//, '');
      if (name) ids.push(name);
    }
    return ids;
  }
}
