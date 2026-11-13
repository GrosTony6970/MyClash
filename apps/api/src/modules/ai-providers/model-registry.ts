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
   * Whether the model accepts the `temperature` sampling param; the OpenAI,
   * Mistral and Google adapters omit it based on this flag — never on an id
   * substring. Every Anthropic row is `false`: API version 2026-10-21 rejects
   * `temperature`/`top_p`/`top_k` with a 400 on every model, and the Anthropic
   * adapter never sends it.
   */
  supportsTemperature: boolean;
  /**
   * Anthropic only: how the adapter keeps thinking out of the reply's `max_tokens`. These
   * models think before they answer when a request leaves `thinking` out, and the thinking
   * counts against `max_tokens`; MyClash's limits are sized for the answer alone (80 tokens on
   * one route). `disabled` and `between_tools` name the request field that turns thinking off
   * on that model; `always_on` is a model that cannot turn it off, so the adapter asks for
   * `low` effort and adds headroom to `max_tokens`. A model id outside the registry sends none.
   */
  anthropicThinking?: 'disabled' | 'between_tools' | 'always_on';
  /**
   * Anthropic only: the model answers 400 to a forced `tool_choice` (`any` / `tool`), so a
   * `required` request is sent as `auto`. Its callers already handle an answer with no tool call.
   */
  rejectsForcedToolChoice?: boolean;
  pricing: { input: number; output: number };
}

/** USD-per-million → EUR-per-token, matching the adapters' prior 0.92 factor. */
const eur = (usdPerMillion: number): number => (usdPerMillion / 1_000_000) * 0.92;

// Model ids and USD prices as the providers published them on 2026-11-13. Where a provider
// has announced a price rise, the row carries the NEW price: the registry prices the per-key
// budget ceilings, and an under-priced row lets a key spend past its ceiling. A model whose
// `temperature` support the provider does not document is `false`: omitting it is always
// accepted, and sending it to a model that rejects it is a 400.
export const MODEL_REGISTRY: Record<AIProvider, ModelInfo[]> = {
  anthropic: [
    {
      id: 'claude-sonnet-5-5',
      label: 'Claude Sonnet 5.5',
      isDefault: true,
      recommendedForToolUse: true,
      supportsTemperature: false,
      anthropicThinking: 'between_tools',
      rejectsForcedToolChoice: true,
      pricing: { input: eur(2), output: eur(10) },
    },
    {
      id: 'claude-opus-5-5',
      label: 'Claude Opus 5.5',
      supportsTemperature: false,
      anthropicThinking: 'always_on',
      rejectsForcedToolChoice: true,
      pricing: { input: eur(4), output: eur(20) },
    },
    {
      id: 'claude-haiku-5-5',
      label: 'Claude Haiku 5.5',
      supportsTemperature: false,
      anthropicThinking: 'disabled',
      // The ≤100K-token prompt rate; longer prompts cost $0.50 / $2.50.
      pricing: { input: eur(0.1), output: eur(0.5) },
    },
  ],
  openai: [
    {
      id: 'gpt-6.1-sol',
      label: 'GPT-6.1 Sol',
      isDefault: true,
      recommendedForToolUse: true,
      supportsTemperature: false,
      pricing: { input: eur(2), output: eur(10) },
    },
    {
      id: 'gpt-6-astra',
      label: 'GPT-6 Astra',
      supportsTemperature: false,
      pricing: { input: eur(10), output: eur(50) },
    },
    {
      id: 'gpt-6.1-terra',
      label: 'GPT-6.1 Terra',
      supportsTemperature: false,
      pricing: { input: eur(1), output: eur(5) },
    },
    {
      id: 'gpt-6-luna',
      label: 'GPT-6 Luna',
      supportsTemperature: false,
      pricing: { input: eur(0.1), output: eur(0.5) },
    },
  ],
  mistral: [
    {
      // Public preview.
      id: 'mistral-large-4',
      label: 'Mistral Large 4',
      isDefault: true,
      recommendedForToolUse: true,
      supportsTemperature: true,
      pricing: { input: eur(0.7), output: eur(2.1) },
    },
    {
      id: 'mistral-small-2603',
      label: 'Mistral Small 4',
      supportsTemperature: true,
      pricing: { input: eur(0.15), output: eur(0.6) },
    },
    {
      id: 'ministral-8b-2512',
      label: 'Ministral 3 8B',
      supportsTemperature: true,
      pricing: { input: eur(0.15), output: eur(0.15) },
    },
  ],
  google: [
    {
      id: 'gemini-4-carbon',
      label: 'Gemini 4 Carbon',
      isDefault: true,
      recommendedForToolUse: true,
      supportsTemperature: false,
      // $2 / $10 until 2026-12-01.
      pricing: { input: eur(4), output: eur(20) },
    },
    {
      id: 'gemini-4-hydrogen',
      label: 'Gemini 4 Hydrogen',
      supportsTemperature: false,
      pricing: { input: eur(1.5), output: eur(7.5) },
    },
    {
      id: 'gemini-3.8-flash',
      label: 'Gemini 3.8 Flash',
      supportsTemperature: true,
      // $0.75 / $3.75 until 2027-01-01.
      pricing: { input: eur(1.5), output: eur(7.5) },
    },
    {
      id: 'gemini-3.5-flash-lite',
      label: 'Gemini 3.5 Flash-Lite',
      supportsTemperature: true,
      pricing: { input: eur(0.3), output: eur(2.5) },
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
