export type AIProvider = 'anthropic' | 'openai' | 'mistral';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface GenerationRequest {
  system: string;
  user: string;
  model: string;
  maxTokens: number;
  temperature: number;
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'required';
}

export interface GenerationResult {
  text: string;
  toolCall?: { name: string; arguments: Record<string, unknown> };
  inputTokens: number;
  outputTokens: number;
  costEur: number;
}

export interface ProviderAdapter {
  generate(apiKey: string, request: GenerationRequest): Promise<GenerationResult>;
}
