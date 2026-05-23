import { Injectable } from '@nestjs/common';
import type {
  GenerationRequest,
  GenerationResult,
  ProviderAdapter,
  ToolDefinition,
} from './provider-adapter.interface';

// @mistralai/mistralai is an ESM-only package; under moduleResolution: "node16"
// a CommonJS file can't statically `import` from it. Load it lazily via a
// dynamic import inside `generate()` so the CJS host code keeps working while
// Node resolves the ESM module at call time.

const PRICING: Record<string, { input: number; output: number }> = {
  'mistral-large-latest': { input: (2 / 1_000_000) * 0.92, output: (6 / 1_000_000) * 0.92 },
  'mistral-small-latest': { input: (0.1 / 1_000_000) * 0.92, output: (0.3 / 1_000_000) * 0.92 },
  'open-mistral-7b': { input: (0.025 / 1_000_000) * 0.92, output: (0.025 / 1_000_000) * 0.92 },
};
const DEFAULT_PRICING = { input: (2 / 1_000_000) * 0.92, output: (6 / 1_000_000) * 0.92 };

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

@Injectable()
export class MistralAdapter implements ProviderAdapter {
  async generate(apiKey: string, request: GenerationRequest): Promise<GenerationResult> {
    const { Mistral } = await import('@mistralai/mistralai');
    const client = new Mistral({ apiKey });
    const response = await client.chat.complete({
      model: request.model,
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      ...(request.tools?.length
        ? {
            tools: mapTools(request.tools),
            toolChoice: request.toolChoice === 'required' ? 'required' : 'auto',
          }
        : {}),
    });

    const choice = response?.choices?.[0];
    const text = typeof choice?.message?.content === 'string' ? choice.message.content : '';

    const rawToolCall = choice?.message?.toolCalls?.[0];
    const toolCall = rawToolCall
      ? {
          name: rawToolCall.function.name,
          arguments:
            typeof rawToolCall.function.arguments === 'string'
              ? (JSON.parse(rawToolCall.function.arguments) as Record<string, unknown>)
              : (rawToolCall.function.arguments as Record<string, unknown>),
        }
      : undefined;

    const inputTokens = response?.usage?.promptTokens ?? 0;
    const outputTokens = response?.usage?.completionTokens ?? 0;
    const pricing = PRICING[request.model] ?? DEFAULT_PRICING;
    const costEur = inputTokens * pricing.input + outputTokens * pricing.output;

    return { text, toolCall, inputTokens, outputTokens, costEur };
  }
}
