'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';

type AIProvider = 'anthropic' | 'openai' | 'mistral';

interface ModelOption {
  id: string;
  label: string;
  isDefault: boolean;
  recommendedForToolUse: boolean;
  supportsTemperature: boolean;
}

interface FighterAIConfig {
  provider: AIProvider;
  hasKey: true;
  model: string | null;
  updatedAt: string;
}

const PROVIDERS: AIProvider[] = ['anthropic', 'openai', 'mistral'];

function defaultModelId(options: ModelOption[]): string {
  return options.find((m) => m.isDefault)?.id ?? options[0]?.id ?? '';
}

/**
 * Personal BYOK AI key — powers the fighter's own performance insight. The key
 * is encrypted server-side; only the provider + model are ever read back.
 */
export function AISettingsSection({ apiUrl }: { apiUrl: string }) {
  const { t } = useI18n();
  const [config, setConfig] = useState<FighterAIConfig | null>(null);
  const [models, setModels] = useState<Record<AIProvider, ModelOption[]>>({
    anthropic: [],
    openai: [],
    mistral: [],
  });
  const [provider, setProvider] = useState<AIProvider>('anthropic');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch(`${apiUrl}/api/v1/ai/models`, { credentials: 'include', signal: controller.signal })
        .then((r) => (r.ok ? (r.json() as Promise<Record<AIProvider, ModelOption[]>>) : null))
        .catch(() => null),
      fetch(`${apiUrl}/api/v1/me/ai-settings`, {
        credentials: 'include',
        signal: controller.signal,
      })
        .then((r) => (r.ok ? (r.json() as Promise<FighterAIConfig | null>) : null))
        .catch(() => null),
    ]).then(([modelData, cfg]) => {
      if (modelData) setModels(modelData);
      if (cfg) {
        setConfig(cfg);
        setProvider(cfg.provider);
        setModel(cfg.model ?? defaultModelId(modelData?.[cfg.provider] ?? []));
      }
    });
    return () => controller.abort();
  }, [apiUrl]);

  const providerModels = models[provider] ?? [];

  function changeProvider(next: AIProvider) {
    setProvider(next);
    const opts = models[next] ?? [];
    setModel((prev) => (opts.some((m) => m.id === prev) ? prev : defaultModelId(opts)));
  }

  async function save() {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/me/ai-settings`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey: apiKey.trim(), model: model || null }),
      });
      if (!res.ok) throw new Error(t('publicApp.meSettings.ai.error'));
      setConfig((await res.json()) as FighterAIConfig);
      setApiKey('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('publicApp.meSettings.ai.error'));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setRemoving(true);
    setError(null);
    try {
      await fetch(`${apiUrl}/api/v1/me/ai-settings`, { method: 'DELETE', credentials: 'include' });
      setConfig(null);
    } catch {
      setError(t('publicApp.meSettings.ai.error'));
    } finally {
      setRemoving(false);
    }
  }

  const input =
    'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30';

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <h2 className="font-display text-lg font-semibold text-foreground">
        {t('publicApp.meSettings.ai.title')}
      </h2>
      <p className="mt-1 text-sm leading-6 text-muted">{t('publicApp.meSettings.ai.subtitle')}</p>

      {config && (
        <p className="mt-3 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
          {t('publicApp.meSettings.ai.currentKey', { provider: config.provider })}
        </p>
      )}

      <div className="mt-4 space-y-3">
        <label className="block text-sm font-semibold text-foreground">
          {t('publicApp.meSettings.ai.provider')}
          <select
            aria-label={t('publicApp.meSettings.ai.provider')}
            value={provider}
            onChange={(e) => changeProvider(e.target.value as AIProvider)}
            className={`mt-1 ${input}`}
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm font-semibold text-foreground">
          {t('publicApp.meSettings.ai.model')}
          <select
            aria-label={t('publicApp.meSettings.ai.model')}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={providerModels.length === 0}
            className={`mt-1 ${input} disabled:opacity-50`}
          >
            {providerModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.recommendedForToolUse
                  ? `${m.label} — ${t('publicApp.meSettings.ai.recommended')}`
                  : m.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm font-semibold text-foreground">
          {t('publicApp.meSettings.ai.apiKey')}
          <input
            type="password"
            aria-label={t('publicApp.meSettings.ai.apiKey')}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              config
                ? t('publicApp.meSettings.ai.apiKeyKeep')
                : t('publicApp.meSettings.ai.apiKeyPlaceholder')
            }
            className={`mt-1 ${input}`}
          />
        </label>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || apiKey.trim().length < 10}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? t('publicApp.meSettings.ai.saving') : t('publicApp.meSettings.ai.save')}
          </button>
          {config && (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={removing}
              className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-background disabled:opacity-50"
            >
              {removing
                ? t('publicApp.meSettings.ai.removing')
                : t('publicApp.meSettings.ai.remove')}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
