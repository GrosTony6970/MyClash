import { describe, expect, it } from 'vitest';
import { getModels, MODEL_REGISTRY } from './model-registry';

describe('model registry', () => {
  // Anthropic API 2026-10-21 answers 400 to `temperature` on every model, and the adapter no
  // longer sends it. The flag is also served to the key form (GET /ai/models), so it must say
  // so for every Anthropic row.
  it('marks every Anthropic model as taking no temperature', () => {
    const anthropic = getModels('anthropic');
    expect(anthropic.length).toBeGreaterThan(0);
    expect(anthropic.filter((m) => m.supportsTemperature).map((m) => m.id)).toEqual([]);
  });

  // Current Anthropic models think by default, and the thinking counts against `max_tokens`:
  // a row with no thinking rule would truncate MyClash's short replies.
  it('says how every Anthropic model keeps thinking out of the reply', () => {
    expect(getModels('anthropic').filter((m) => !m.anthropicThinking)).toEqual([]);
  });

  it('keeps the Anthropic-only fields on Anthropic rows', () => {
    const others = (['openai', 'mistral', 'google'] as const).flatMap((p) => MODEL_REGISTRY[p]);
    expect(others.filter((m) => m.anthropicThinking || m.rejectsForcedToolChoice)).toEqual([]);
  });

  it('gives every provider exactly one default', () => {
    for (const provider of Object.keys(MODEL_REGISTRY) as (keyof typeof MODEL_REGISTRY)[]) {
      expect(getModels(provider).filter((m) => m.isDefault)).toHaveLength(1);
    }
  });
});
