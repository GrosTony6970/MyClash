export interface FeatureFlagDefinition {
  key: string;
  labelKey: string;
  descriptionKey: string;
  default: boolean;
}

export const FEATURE_FLAG_REGISTRY: readonly FeatureFlagDefinition[] = [
  {
    key: 'admin_lockdown',
    labelKey: 'admin.featureFlags.lockdown.title',
    descriptionKey: 'admin.featureFlags.lockdown.description',
    default: false,
  },
] as const;

const KNOWN_KEYS = new Set(FEATURE_FLAG_REGISTRY.map((f) => f.key));

export type KnownFeatureFlagKey = 'admin_lockdown';

export function isKnownFlagKey(value: string): value is KnownFeatureFlagKey {
  return KNOWN_KEYS.has(value);
}

export function getFlagDefinition(key: KnownFeatureFlagKey): FeatureFlagDefinition {
  const def = FEATURE_FLAG_REGISTRY.find((f) => f.key === key);
  if (!def) throw new Error(`Unknown feature flag: ${key}`);
  return def;
}
