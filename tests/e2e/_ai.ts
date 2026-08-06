import type { Api } from './_api';

/**
 * Shared AI-key plumbing for the two AI specs (30-ai-settings, 31-ai-generation).
 *
 * The three key scopes — organization, fighter, platform — are the SAME CRUD
 * surface behind three base paths, because they are one `AiKeyStore` behind
 * three `AiKeyScopeConfig`s server-side. So one helper drives all three.
 *
 * The reason this file exists rather than the specs each rolling their own:
 * activating a key goes through the scope's `set_active_*_ai_key` RPC, which
 * DEACTIVATES every other key in that scope. A spec that installs its own key
 * and walks away leaves the operator's real key switched off, and nothing would
 * report it — the settings page would just quietly say the wrong thing. Every
 * install here is therefore snapshot → install → run → restore, with the
 * restore in a `finally`.
 */

export type AiProvider = 'anthropic' | 'openai' | 'mistral' | 'google';

/** The masked list item every key scope returns. Never carries the secret. */
export interface AiKey {
  id: string;
  label: string;
  provider: AiProvider;
  model: string | null;
  keyLast4: string | null;
  monthlyBudgetEur: number | null;
  spentMtdEur: number;
  isActive: boolean;
  updatedAt: string;
}

/** UI-facing model option from `GET /ai/models` (no pricing). */
export interface ModelOption {
  id: string;
  label: string;
  isDefault: boolean;
  recommendedForToolUse: boolean;
  supportsTemperature: boolean;
}

export const AI_PROVIDERS: readonly AiProvider[] = ['anthropic', 'openai', 'mistral', 'google'];

/**
 * The cheapest model per provider, mirrored from
 * `apps/api/src/modules/ai-providers/model-registry.ts` (lowest `pricing.input`).
 *
 * Mirrored rather than imported: the e2e runner resolves workspace packages
 * poorly and the registry lives in the API app, not a package — the same reason
 * `_api.ts` stays import-free. `GET /ai/models` can't supply it either, since it
 * deliberately omits pricing.
 *
 * If the registry renames one of these, key creation answers 400 "Unknown model
 * ..." and the spec fails loudly. That is the intended failure: silently falling
 * back to the provider default would bill Opus prices for a test run.
 */
export const CHEAPEST_MODEL: Record<AiProvider, string> = {
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-5.6-luna',
  mistral: 'open-mistral-7b',
  google: 'gemini-3.1-flash-lite',
};

/** Key-scope base paths. All three expose list/create/patch/delete/:id/activate. */
export const orgKeysPath = (orgId: string) => `organizations/${orgId}/ai-keys`;
export const FIGHTER_KEYS_PATH = 'me/ai-keys';
export const PLATFORM_KEYS_PATH = 'admin/ai-keys';

export interface LiveAiConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
  budgetEur: number;
}

/**
 * The real provider credentials for the generation spec, from `.env.e2e`.
 * Returns null when unset so the caller can skip rather than fail — a run
 * without a key degrades to the zero-cost half instead of going red.
 */
export function liveAiConfig(): LiveAiConfig | null {
  const provider = (process.env.E2E_AI_PROVIDER ?? '').trim().toLowerCase();
  const apiKey = (process.env.E2E_AI_KEY ?? '').trim();
  if (!provider || !apiKey) return null;
  if (!AI_PROVIDERS.includes(provider as AiProvider)) {
    throw new Error(
      `[e2e] E2E_AI_PROVIDER="${provider}" is not one of ${AI_PROVIDERS.join(', ')}. ` +
        'It must match the provider that issued E2E_AI_KEY.',
    );
  }
  const typed = provider as AiProvider;
  return {
    provider: typed,
    apiKey,
    // Default to the cheapest model, never the provider default (which is the
    // most expensive one in every provider's registry entry).
    model: (process.env.E2E_AI_MODEL ?? '').trim() || CHEAPEST_MODEL[typed],
    // A blast-radius cap stamped on the installed key: a runaway loop hits
    // BudgetExceededException instead of billing on.
    budgetEur: Number(process.env.E2E_AI_BUDGET_EUR ?? '1') || 1,
  };
}

/** A fake key for the CRUD assertions. `apiKey` is only `z.string().min(10)` and
 *  is never sent to a provider on create, so this costs nothing. */
export const FAKE_KEY = 'sk-e2e-not-a-real-key-0000000000';

/** `GET <scope>` — the masked key list. */
export async function getKeys(api: Api, scope: string): Promise<AiKey[]> {
  return api.json<AiKey[]>(await api.get(scope));
}

export interface InstallKeyOptions {
  label: string;
  provider: AiProvider;
  apiKey: string;
  model?: string | null;
  monthlyBudgetEur?: number | null;
}

export interface InstalledKey {
  key: AiKey;
  /** Put the scope back exactly as it was found. Safe to call twice. */
  restore: () => Promise<void>;
}

/**
 * Install a key in `scope` and make it the active one, returning a `restore`
 * that undoes both.
 *
 * The restore order matters: deleting the active key makes the store promote
 * some OTHER key to active on its own, and that is not necessarily the one that
 * was active before. So it deletes first and re-activates the snapshot second.
 *
 * Use this from `beforeAll`/`afterAll` when several tests share one key;
 * `withInstalledKey` wraps it for the single-test case.
 */
export async function installKey(
  api: Api,
  scope: string,
  options: InstallKeyOptions,
): Promise<InstalledKey> {
  const before = await getKeys(api, scope);
  const previouslyActive = before.find((k) => k.isActive) ?? null;

  const key = await api.json<AiKey>(
    await api.post(scope, {
      data: {
        label: options.label,
        provider: options.provider,
        apiKey: options.apiKey,
        model: options.model ?? null,
        monthlyBudgetEur: options.monthlyBudgetEur ?? null,
        isActive: true,
      },
    }),
  );

  // `isActive: true` on create is honoured by the store, but verify rather than
  // assume: every generation leg depends on THIS key being the one that serves.
  const afterCreate = await getKeys(api, scope);
  if (!afterCreate.find((k) => k.id === key.id)?.isActive) {
    await api.ok(await api.post(`${scope}/${key.id}/activate`));
  }

  let restored = false;
  return {
    key,
    restore: async () => {
      if (restored) return;
      restored = true;
      await api.delete(`${scope}/${key.id}`);
      if (previouslyActive) await api.post(`${scope}/${previouslyActive.id}/activate`);
    },
  };
}

/** `installKey` around a single block, restored even when the block throws. */
export async function withInstalledKey<T>(
  api: Api,
  scope: string,
  options: InstallKeyOptions,
  fn: (key: AiKey) => Promise<T>,
): Promise<T> {
  const installed = await installKey(api, scope, options);
  try {
    return await fn(installed.key);
  } finally {
    await installed.restore();
  }
}

/**
 * Run `fn` with the org's AI kill-switch flags set to `flags`, then restore the
 * values that were there before. These are LIVE org settings on a deployed
 * environment — an unrestored `aiFeaturesDisabled: true` silently turns AI off
 * for a real organizer.
 */
export async function withOrgAiFlags<T>(
  api: Api,
  orgId: string,
  flags: { aiFeaturesDisabled?: boolean; organizerChatDisabled?: boolean },
  fn: () => Promise<T>,
): Promise<T> {
  const before = await api.json<OrgAiConfig | null>(
    await api.get(`organizations/${orgId}/ai-settings`),
  );
  await api.ok(await api.patch(`organizations/${orgId}/ai-settings/flags`, { data: flags }));
  try {
    return await fn();
  } finally {
    await api.patch(`organizations/${orgId}/ai-settings/flags`, {
      data: {
        aiFeaturesDisabled: before?.aiFeaturesDisabled ?? false,
        organizerChatDisabled: before?.organizerChatDisabled ?? false,
      },
    });
  }
}

/** `GET organizations/:orgId/ai-settings` — null when the org has neither settings row nor key. */
export interface OrgAiConfig {
  hasKey: boolean;
  monthlyBudgetEur: number | null;
  aiFeaturesDisabled: boolean;
  organizerChatDisabled: boolean;
  updatedAt: string | null;
}

/** `GET organizations/:orgId/ai-usage/summary`. */
export interface UsageRollup {
  total: { costEur: number; calls: number };
}

/** `GET events/:eventId/ai-usage`. */
export interface EventUsage {
  totalSpendEur: number;
  cap: number | null;
  remainingEur: number | null;
  callCount: number;
}

/** `GET|POST generated-content/:type/:entityId[...]`. */
export interface GeneratedContent {
  contentType: string;
  entityId: string;
  locale: string;
  content: string;
  status: 'draft' | 'published';
  model: string | null;
  generatedAt: string;
  publishedAt: string | null;
}
