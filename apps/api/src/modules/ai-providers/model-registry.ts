import type { AIProvider } from './adapters/provider-adapter.interface';

/**
 * Single source of truth for the AI models MyClash offers per provider.
 *
 * Drives: adapter pricing, adapter param-shaping (temperature omission),
 * settings DTO validation, model resolution for the `'default'` sentinel, and
 * the `GET /ai/models` endpoint the settings UI reads.
 *
 * `pricing` is EUR-per-token and bakes in the historical 0.92 USD→EUR factor
 * the adapters used, so cost math and `ai_usage_log.cost_eur` stay comparable.
 */
export interface ModelInfo {
  id: string;
  label: string;
  /** The provider's default when no model is stored / `'default'` is requested. */
  isDefault?: boolean;
  /** Surfaced in the UI as the suggested model for the tool-calling chatbot. */
  recommendedForToolUse?: boolean;
  /**
   * Whether the model accepts the `temperature` sampling param. Anthropic
   * Opus 4.7/4.8 reject `temperature`/`top_p`/`top_k` with a 400, so the
   * adapters must omit it based on this flag — never on an id substring.
   */
  supportsTemperature: boolean;
  pricing: { input: number; output: number };
}

/** USD-per-million → EUR-per-token, matching the adapters' prior 0.92 factor. */
const eur = (usdPerMillion: number): number => (usdPerMillion / 1_000_000) * 0.92;

export const MODEL_REGISTRY: Record<AIProvider, ModelInfo[]> = {
  anthropic: [
    {
      id: 'claude-opus-4-8',
      label: 'Claude Opus 4.8',
      isDefault: true,
      recommendedForToolUse: true,
      supportsTemperature: false,
      pricing: { input: eur(5), output: eur(25) },
    },
    {
      id: 'claude-sonnet-4-6',
      label: 'Claude Sonnet 4.6',
      supportsTemperature: true,
      pricing: { input: eur(3), output: eur(15) },
    },
    {
      id: 'claude-haiku-4-5',
      label: 'Claude Haiku 4.5',
      supportsTemperature: true,
      pricing: { input: eur(1), output: eur(5) },
    },
  ],
  openai: [
    {
      id: 'gpt-4o',
      label: 'GPT-4o',
      isDefault: true,
      recommendedForToolUse: true,
      supportsTemperature: true,
      pricing: { input: eur(2.5), output: eur(10) },
    },
    {
      id: 'gpt-4o-mini',
      label: 'GPT-4o mini',
      supportsTemperature: true,
      pricing: { input: eur(0.15), output: eur(0.6) },
    },
    {
      id: 'gpt-4-turbo',
      label: 'GPT-4 Turbo',
      supportsTemperature: true,
      pricing: { input: eur(10), output: eur(30) },
    },
  ],
  mistral: [
    {
      id: 'mistral-large-latest',
      label: 'Mistral Large',
      isDefault: true,
      recommendedForToolUse: true,
      supportsTemperature: true,
      pricing: { input: eur(2), output: eur(6) },
    },
    {
      id: 'mistral-small-latest',
      label: 'Mistral Small',
      supportsTemperature: true,
      pricing: { input: eur(0.1), output: eur(0.3) },
    },
    {
      id: 'open-mistral-7b',
      label: 'Open Mistral 7B',
      supportsTemperature: true,
      pricing: { input: eur(0.025), output: eur(0.025) },
    },
  ],
};

/** Sentinel callers may pass when they want the configured/default model. */
export const DEFAULT_MODEL_SENTINEL = 'default';

export function getModels(provider: AIProvider): ModelInfo[] {
  return MODEL_REGISTRY[provider] ?? [];
}

export function getDefaultModel(provider: AIProvider): ModelInfo {
  const models = getModels(provider);
  const found = models.find((m) => m.isDefault) ?? models[0];
  if (!found) throw new Error(`No models registered for provider "${provider}"`);
  return found;
}

export function findModel(
  provider: AIProvider,
  id: string | null | undefined,
): ModelInfo | undefined {
  if (!id) return undefined;
  return getModels(provider).find((m) => m.id === id);
}

export function isValidModelForProvider(provider: AIProvider, id: string): boolean {
  return findModel(provider, id) !== undefined;
}

/**
 * Resolve a requested model to a concrete `ModelInfo`.
 * `'default'`/falsy/unknown → the provider default; a valid concrete id → that model.
 * The caller is responsible for substituting a stored settings model for the
 * `'default'` sentinel before calling this (see `AIProvidersService.generate`).
 */
export function resolveModel(
  provider: AIProvider,
  requested: string | null | undefined,
): ModelInfo {
  if (requested && requested !== DEFAULT_MODEL_SENTINEL) {
    const found = findModel(provider, requested);
    if (found) return found;
  }
  return getDefaultModel(provider);
}

/** UI-facing view of a model (no pricing). */
export interface ModelOption {
  id: string;
  label: string;
  isDefault: boolean;
  recommendedForToolUse: boolean;
  supportsTemperature: boolean;
}

export function getModelOptions(provider: AIProvider): ModelOption[] {
  return getModels(provider).map((m) => ({
    id: m.id,
    label: m.label,
    isDefault: m.isDefault ?? false,
    recommendedForToolUse: m.recommendedForToolUse ?? false,
    supportsTemperature: m.supportsTemperature,
  }));
}

export function getAllModelOptions(): Record<AIProvider, ModelOption[]> {
  return {
    anthropic: getModelOptions('anthropic'),
    openai: getModelOptions('openai'),
    mistral: getModelOptions('mistral'),
  };
}
