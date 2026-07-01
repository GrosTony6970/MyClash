/**
 * Curated platform feature-flag registry. The set is intentionally
 * narrow — every entry is something a super-admin can flip from
 * `/admin/feature-flags` to change runtime behaviour without a
 * deploy. New entries land in this file (one-stop source of truth);
 * the admin UI auto-renders them, and the backend wires the gate
 * with `flags.isEnabled('<key>')`.
 *
 * The optional `group` field clusters the toggles in the admin UI so
 * the wall of switches reads as three buckets rather than a flat
 * list. The optional `payload` discriminator tells the admin UI a
 * flag carries structured config (today only `maintenance_banner`,
 * which uses `payload_json` to carry { message, severity }).
 */
export type FeatureFlagGroup = 'incident' | 'delivery' | 'reliability';
export type FeatureFlagPayloadShape = 'maintenance_banner';

export interface FeatureFlagDefinition {
  key: string;
  labelKey: string;
  descriptionKey: string;
  default: boolean;
  /** Cluster heading shown above the toggle on the admin UI. */
  group?: FeatureFlagGroup;
  /**
   * If set, the admin UI renders extra controls (message + severity
   * for `maintenance_banner`) and the upsert endpoint persists the
   * payload alongside the boolean.
   */
  payload?: FeatureFlagPayloadShape;
}

export const FEATURE_FLAG_REGISTRY: readonly FeatureFlagDefinition[] = [
  {
    key: 'admin_lockdown',
    labelKey: 'admin.featureFlags.lockdown.title',
    descriptionKey: 'admin.featureFlags.lockdown.description',
    default: false,
    group: 'incident',
  },
  {
    key: 'read_only_mode',
    labelKey: 'admin.featureFlags.readOnlyMode.title',
    descriptionKey: 'admin.featureFlags.readOnlyMode.description',
    default: false,
    group: 'incident',
  },
  {
    key: 'disable_signups',
    labelKey: 'admin.featureFlags.disableSignups.title',
    descriptionKey: 'admin.featureFlags.disableSignups.description',
    default: false,
    group: 'incident',
  },
  {
    key: 'disable_public_signups',
    labelKey: 'admin.featureFlags.disablePublicSignups.title',
    descriptionKey: 'admin.featureFlags.disablePublicSignups.description',
    default: false,
    group: 'incident',
  },
  {
    key: 'maintenance_banner',
    labelKey: 'admin.featureFlags.maintenanceBanner.title',
    descriptionKey: 'admin.featureFlags.maintenanceBanner.description',
    default: false,
    group: 'incident',
    payload: 'maintenance_banner',
  },
  {
    key: 'disable_ai_features',
    labelKey: 'admin.featureFlags.disableAiFeatures.title',
    descriptionKey: 'admin.featureFlags.disableAiFeatures.description',
    default: false,
    group: 'delivery',
  },
  {
    key: 'disable_organizer_chat',
    labelKey: 'admin.featureFlags.disableOrganizerChat.title',
    descriptionKey: 'admin.featureFlags.disableOrganizerChat.description',
    default: false,
    group: 'delivery',
  },
  {
    key: 'disable_hema_sync',
    labelKey: 'admin.featureFlags.disableHemaSync.title',
    descriptionKey: 'admin.featureFlags.disableHemaSync.description',
    default: false,
    group: 'delivery',
  },
  {
    key: 'disable_email',
    labelKey: 'admin.featureFlags.disableEmail.title',
    descriptionKey: 'admin.featureFlags.disableEmail.description',
    default: false,
    group: 'delivery',
  },
  {
    key: 'disable_realtime',
    labelKey: 'admin.featureFlags.disableRealtime.title',
    descriptionKey: 'admin.featureFlags.disableRealtime.description',
    default: false,
    group: 'reliability',
  },
] as const;

const KNOWN_KEYS = new Set(FEATURE_FLAG_REGISTRY.map((f) => f.key));

export type KnownFeatureFlagKey =
  | 'admin_lockdown'
  | 'read_only_mode'
  | 'disable_signups'
  | 'disable_public_signups'
  | 'maintenance_banner'
  | 'disable_ai_features'
  | 'disable_organizer_chat'
  | 'disable_hema_sync'
  | 'disable_email'
  | 'disable_realtime';

export function isKnownFlagKey(value: string): value is KnownFeatureFlagKey {
  return KNOWN_KEYS.has(value);
}

export function getFlagDefinition(key: KnownFeatureFlagKey): FeatureFlagDefinition {
  const def = FEATURE_FLAG_REGISTRY.find((f) => f.key === key);
  if (!def) throw new Error(`Unknown feature flag: ${key}`);
  return def;
}

/**
 * Payload shape for the `maintenance_banner` flag — surfaced
 * through `GET /api/v1/public/feature-flags` so every frontend app
 * can render the banner without an authenticated call.
 */
export type MaintenanceBannerSeverity = 'info' | 'warning' | 'critical';

export interface MaintenanceBannerPayload {
  message: string;
  severity: MaintenanceBannerSeverity;
}

/**
 * Public feature-flags snapshot shape — what the FE consumes from
 * `GET /api/v1/public/feature-flags`. Only flags meant for FE
 * awareness leak through; internal kill-switches stay server-side.
 */
export interface PublicFeatureFlagsSnapshot {
  maintenanceBanner: {
    enabled: boolean;
    message: string | null;
    severity: MaintenanceBannerSeverity | null;
  };
  realtimeDisabled: boolean;
}
