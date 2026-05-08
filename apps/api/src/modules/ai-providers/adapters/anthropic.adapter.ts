import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';
import type {
  GenerationRequest,
  GenerationResult,
  ProviderAdapter,
  ToolDefinition,
} from './provider-adapter.interface';

// EUR prices per token (approximate). Update when Anthropic updates pricing.
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-3-5-sonnet-20241022': { input: (3 / 1_000_000) * 0.92, output: (15 / 1_000_000) * 0.92 },
  'claude-3-5-haiku-20241022': { input: (0.8 / 1_000_000) * 0.92, output: (4 / 1_000_000) * 0.92 },
  'claude-3-opus-20240229': { input: (15 / 1_000_000) * 0.92, output: (75 / 1_000_000) * 0.92 },
};
const DEFAULT_PRICING = { input: (3 / 1_000_000) * 0.92, output: (15 / 1_000_000) * 0.92 };

function mapTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool['input_schema'],
  }));
}

@Injectable()
export class AnthropicAdapter implements ProviderAdapter {
  async generate(apiKey: string, request: GenerationRequest): Promise<GenerationResult> {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      system: request.system,
      messages: [{ role: 'user', content: request.user }],
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

    const toolBlock = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );
    const toolCall = toolBlock
      ? { name: toolBlock.name, arguments: toolBlock.input as Record<string, unknown> }
      : undefined;

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const pricing = PRICING[request.model] ?? DEFAULT_PRICING;
    const costEur = inputTokens * pricing.input + outputTokens * pricing.output;

    return { text, toolCall, inputTokens, outputTokens, costEur };
  }
}
