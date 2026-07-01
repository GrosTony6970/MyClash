export type AIProvider = 'anthropic' | 'openai' | 'mistral' | 'google';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type ChatRole = 'user' | 'assistant' | 'tool';

export interface ToolCall {
  /** Provider-assigned id used to correlate the result back to the call. */
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultPart {
  toolCallId: string;
  /** JSON-stringified tool output. */
  content: string;
  isError?: boolean;
}

/**
 * A single turn in a multi-turn transcript. `assistant` turns may carry
 * `toolCalls`; `tool` turns carry `toolResults` (one per prior tool call).
 */
export interface ChatMessage {
  role: ChatRole;
  content?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResultPart[];
}

export interface GenerationRequest {
  system: string;
  /** Single-turn prompt. Ignored when `messages` is provided. */
  user?: string;
  /**
   * Multi-turn transcript. When present, supersedes `user` and enables the
   * agentic tool-calling loop (adapters map it to provider-native blocks and
   * return every tool call in `GenerationResult.toolCalls`).
   */
  messages?: ChatMessage[];
  model: string;
  maxTokens: number;
  temperature: number;
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'required';
}

export type GenerationStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

export interface GenerationResult {
  text: string;
  /** First tool call, kept for the single-shot callers (draft flow, NLQ). */
  toolCall?: { name: string; arguments: Record<string, unknown> };
  /** All tool calls the model emitted this turn (multi-turn chat loop). */
  toolCalls?: ToolCall[];
  stopReason?: GenerationStopReason;
  /** Resolved model + provider that served the request (set by AIProvidersService). */
  model?: string;
  provider?: AIProvider;
  /** Id of the stored key that served the request, for per-key usage metering. */
  keyId?: string;
  inputTokens: number;
  outputTokens: number;
  costEur: number;
}

export interface ProviderAdapter {
  generate(apiKey: string, request: GenerationRequest): Promise<GenerationResult>;
  /**
   * List the model ids the provider currently serves for this key. Powers the
   * super-admin model-sync drift report (registry vs. live). Read-only.
   */
  listModels(apiKey: string): Promise<string[]>;
}
