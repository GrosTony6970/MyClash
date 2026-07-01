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
      id: 'claude-sonnet-5',
      label: 'Claude Sonnet 5',
      // Sonnet 5, like Opus 4.7/4.8, 400s on non-default sampling params — omit.
      supportsTemperature: false,
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
      id: 'gpt-5.5',
      label: 'GPT-5.5',
      isDefault: true,
      recommendedForToolUse: true,
      // 5.5 re-enabled `temperature` (unlike the GPT-5 reasoning family).
      supportsTemperature: true,
      pricing: { input: eur(5), output: eur(30) },
    },
    {
      id: 'gpt-5.6-sol',
      label: 'GPT-5.6 Sol',
      // 5.6 family: omit `temperature` unless confirmed accepted (omitting is
      // always safe; sending it to a model that rejects it is a 400).
      supportsTemperature: false,
      pricing: { input: eur(5), output: eur(30) },
    },
    {
      id: 'gpt-5.6-terra',
      label: 'GPT-5.6 Terra',
      supportsTemperature: false,
      pricing: { input: eur(2.5), output: eur(15) },
    },
    {
      id: 'gpt-5.6-luna',
      label: 'GPT-5.6 Luna',
      supportsTemperature: false,
      pricing: { input: eur(1), output: eur(6) },
    },
  ],
  mistral: [
    {
      id: 'mistral-medium-3.5',
      label: 'Mistral Medium 3.5',
      isDefault: true,
      recommendedForToolUse: true,
      supportsTemperature: true,
      pricing: { input: eur(1.5), output: eur(7.5) },
    },
    {
      id: 'mistral-small-4',
      label: 'Mistral Small 4',
      supportsTemperature: true,
      pricing: { input: eur(0.15), output: eur(0.6) },
    },
    {
      id: 'open-mistral-7b',
      label: 'Open Mistral 7B',
      supportsTemperature: true,
      pricing: { input: eur(0.025), output: eur(0.025) },
    },
  ],
  google: [
    {
      id: 'gemini-3.5-flash',
      label: 'Gemini 3.5 Flash',
      isDefault: true,
      recommendedForToolUse: true,
      supportsTemperature: true,
      pricing: { input: eur(1.5), output: eur(9) },
    },
    {
      id: 'gemini-3.1-pro-preview',
      label: 'Gemini 3.1 Pro',
      supportsTemperature: true,
      // Base (≤200K context) tier; the registry stores flat pricing.
      pricing: { input: eur(2), output: eur(12) },
    },
    {
      id: 'gemini-3.1-flash-lite',
      label: 'Gemini 3.1 Flash-Lite',
      supportsTemperature: true,
      pricing: { input: eur(0.25), output: eur(1.5) },
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

/**
 * The lowest input-priced model for a provider. Used for cheap bulk work (e.g.
 * the data-quality ranking scan) so it never hardcodes a provider-specific id.
 */
export function getCheapestModel(provider: AIProvider): ModelInfo {
  const found = getModels(provider).reduce<ModelInfo | undefined>(
    (min, m) => (!min || m.pricing.input < min.pricing.input ? m : min),
    undefined,
  );
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
    google: getModelOptions('google'),
  };
}
