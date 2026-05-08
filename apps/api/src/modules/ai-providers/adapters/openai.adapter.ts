import OpenAI from 'openai';
import type { ChatCompletionMessageFunctionToolCall } from 'openai/resources/chat/completions/completions';
import { Injectable } from '@nestjs/common';
import type {
  GenerationRequest,
  GenerationResult,
  ProviderAdapter,
  ToolDefinition,
} from './provider-adapter.interface';

const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: (2.5 / 1_000_000) * 0.92, output: (10 / 1_000_000) * 0.92 },
  'gpt-4o-mini': { input: (0.15 / 1_000_000) * 0.92, output: (0.6 / 1_000_000) * 0.92 },
  'gpt-4-turbo': { input: (10 / 1_000_000) * 0.92, output: (30 / 1_000_000) * 0.92 },
};
const DEFAULT_PRICING = { input: (2.5 / 1_000_000) * 0.92, output: (10 / 1_000_000) * 0.92 };

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

@Injectable()
export class OpenAIAdapter implements ProviderAdapter {
  async generate(apiKey: string, request: GenerationRequest): Promise<GenerationResult> {
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: request.model,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      ...(request.tools?.length
        ? {
            tools: mapTools(request.tools),
            tool_choice: request.toolChoice === 'required' ? 'required' : 'auto',
          }
        : {}),
    });

    const choice = response.choices[0];
    const text = choice?.message?.content ?? '';

    const rawToolCallEntry = choice?.message?.tool_calls?.[0];
    const rawToolCall =
      rawToolCallEntry && 'function' in rawToolCallEntry
        ? (rawToolCallEntry as ChatCompletionMessageFunctionToolCall)
        : undefined;
    let toolCall: { name: string; arguments: Record<string, unknown> } | undefined;
    if (rawToolCall && 'function' in rawToolCall) {
      try {
        toolCall = {
          name: rawToolCall.function.name,
          arguments: JSON.parse(rawToolCall.function.arguments) as Record<string, unknown>,
        };
      } catch {
        toolCall = { name: rawToolCall.function.name, arguments: {} };
      }
    }

    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    const pricing = PRICING[request.model] ?? DEFAULT_PRICING;
    const costEur = inputTokens * pricing.input + outputTokens * pricing.output;

    return { text, toolCall, inputTokens, outputTokens, costEur };
  }
}
