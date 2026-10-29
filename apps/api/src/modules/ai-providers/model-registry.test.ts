import { describe, expect, it } from 'vitest';
import { getModels } from './model-registry';

describe('model registry', () => {
  // Anthropic API 2026-10-21 answers 400 to `temperature` on every model, and the adapter no
  // longer sends it. The flag is also served to the key form (GET /ai/models), so it must say
  // so for every Anthropic row.
  it('marks every Anthropic model as taking no temperature', () => {
    const anthropic = getModels('anthropic');
    expect(anthropic.length).toBeGreaterThan(0);
    expect(anthropic.filter((m) => m.supportsTemperature).map((m) => m.id)).toEqual([]);
  });
});
