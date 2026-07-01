'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import { AiUsageView, type UsageRollup } from '../../../../../src/components/ai/AiUsageView';
import { AiBudgetView } from '../../../../../src/components/ai/AiBudgetView';

type AIProvider = 'anthropic' | 'openai' | 'mistral';
type Tab = 'keys' | 'usage' | 'budget';

interface ModelOption {
  id: string;
  label: string;
  isDefault: boolean;
  recommendedForToolUse: boolean;
  supportsTemperature: boolean;
}

interface AIConfig {
  provider: AIProvider;
  hasKey: true;
  model: string | null;
  monthlyBudgetEur: number | null;
  aiFeaturesDisabled: boolean;
  organizerChatDisabled: boolean;
  updatedAt: string;
}

const PROVIDERS: { id: AIProvider; label: string }[] = [
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'mistral', label: 'Mistral' },
];

const TABS: { id: Tab; key: string }[] = [
  { id: 'keys', key: 'admin.aiSettings.tabKeys' },
  { id: 'usage', key: 'admin.aiSettings.tabUsage' },
  { id: 'budget', key: 'admin.aiSettings.tabBudget' },
];

function defaultModelId(options: ModelOption[]): string {
  return options.find((m) => m.isDefault)?.id ?? options[0]?.id ?? '';
}

export default function OrgAISettingsPage() {
  const params = useParams<{ slug: string }>();
  const { slug } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t, locale } = useI18n();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [config, setConfig] = useState<AIConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('keys');
  const [rollup, setRollup] = useState<UsageRollup | null>(null);

  // Keys form state
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState<string>('');
  const [models, setModels] = useState<Record<AIProvider, ModelOption[]>>({
    anthropic: [],
    openai: [],
    mistral: [],
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`${apiUrl}/api/v1/ai/models`, { credentials: 'include', signal: controller.signal })
        .then((res) => (res.ok ? (res.json() as Promise<Record<AIProvider, ModelOption[]>>) : null))
        .catch(() => null),
      fetch(`${apiUrl}/api/v1/organizations/slug/${encodeURIComponent(slug)}`, {
        credentials: 'include',
        signal: controller.signal,
      }).then(async (res) => (res.ok ? ((await res.json()) as { id: string }) : null)),
    ])
      .then(async ([modelData, org]) => {
        if (modelData) setModels(modelData);
        if (!org) return;
        setOrgId(org.id);
        const cfgRes = await fetch(`${apiUrl}/api/v1/organizations/${org.id}/ai-settings`, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (cfgRes.ok) {
          const data = (await cfgRes.json()) as AIConfig | null;
          setConfig(data);
          const nextProvider = data?.provider ?? 'anthropic';
          setSelectedProvider(nextProvider);
          setModel(data?.model ?? defaultModelId(modelData?.[nextProvider] ?? []));
        }
        const usageRes = await fetch(`${apiUrl}/api/v1/organizations/${org.id}/ai-usage/summary`, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (usageRes.ok) setRollup((await usageRes.json()) as UsageRollup);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(t('admin.common.loadAiSettingsFailed'));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [slug, apiUrl, t]);

  async function refreshRollup() {
    if (!orgId) return;
    const res = await fetch(`${apiUrl}/api/v1/organizations/${orgId}/ai-usage/summary`, {
      credentials: 'include',
    });
    if (res.ok) setRollup((await res.json()) as UsageRollup);
  }

  function handleProviderChange(next: AIProvider) {
    setSelectedProvider(next);
    const providerModels = models[next] ?? [];
    setModel((prev) =>
      providerModels.some((m) => m.id === prev) ? prev : defaultModelId(providerModels),
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId || !apiKey.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/organizations/${orgId}/ai-settings`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedProvider,
          apiKey: apiKey.trim(),
          model: model || null,
        }),
      });
      if (!res.ok) {
        setSaveError(t('admin.common.saveApiKeyFailed'));
        return;
      }
      const updated = (await res.json()) as AIConfig | null;
      setConfig(updated);
      setApiKey('');
    } catch {
      setSaveError(t('admin.common.saveApiKeyFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!orgId) return;
    setRemoving(true);
    try {
      await fetch(`${apiUrl}/api/v1/organizations/${orgId}/ai-settings`, {
        method: 'DELETE',
        credentials: 'include',
      });
      setConfig(null);
    } catch {
      setRemoveError(t('admin.common.removeApiKeyFailed'));
    } finally {
      setRemoving(false);
    }
  }

  async function saveFlags(patch: {
    aiFeaturesDisabled?: boolean;
    organizerChatDisabled?: boolean;
  }) {
    if (!orgId) return;
    const res = await fetch(`${apiUrl}/api/v1/organizations/${orgId}/ai-settings/flags`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) setConfig((await res.json()) as AIConfig | null);
  }

  async function saveBudget(value: number | null) {
    if (!orgId) throw new Error(t('admin.aiSettings.budgetError'));
    const res = await fetch(`${apiUrl}/api/v1/organizations/${orgId}/ai-settings/budget`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthlyBudgetEur: value }),
    });
    if (!res.ok) throw new Error(t('admin.aiSettings.budgetError'));
    setConfig((await res.json()) as AIConfig | null);
    await refreshRollup();
  }

  const providerModels = models[selectedProvider] ?? [];

  if (loading) {
    return (
      <main className="p-8 max-w-2xl">
        <div className="flex items-center gap-2 text-muted text-sm">
          <span className="w-4 h-4 border-2 border-muted border-t-transparent rounded-full animate-spin" />
          {t('common.loading')}
        </div>
      </main>
    );
  }

  return (
    <main className="p-8 max-w-3xl">
      <div className="flex items-center gap-2 text-sm text-muted mb-1">
        <Link href={`/org/${slug}`} className="hover:text-foreground-secondary">
          {slug}
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">{t('admin.aiSettings.org.breadcrumb')}</span>
      </div>

      <h1 className="font-display font-bold text-2xl sm:text-3xl mb-1 mt-4">
        {t('admin.aiSettings.title')}
      </h1>
      <p className="text-muted text-sm mb-6">{t('admin.aiSettings.org.description')}</p>

      <div className="mb-6 flex gap-1 border-b border-border">
        {TABS.map((tabDef) => (
          <button
            key={tabDef.id}
            type="button"
            onClick={() => setTab(tabDef.id)}
            className={[
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium',
              tab === tabDef.id
                ? 'border-accent text-foreground'
                : 'border-transparent text-muted hover:text-foreground-secondary',
            ].join(' ')}
          >
            {t(tabDef.key)}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 mb-6 text-sm">
          {error}
        </div>
      )}

      {tab === 'keys' && (
        <>
          {!config && (
            <div className="bg-warning/10 border border-warning/30 text-warning rounded-lg px-4 py-3 mb-6 text-sm">
              {t('admin.aiSettings.org.keyDisabled')}
            </div>
          )}

          {config && (
            <div className="bg-success/10 border border-success/30 text-success rounded-lg px-4 py-3 mb-2 text-sm flex items-center justify-between">
              <span>
                {t('admin.aiSettings.org.keySavedUpdated', {
                  provider:
                    PROVIDERS.find((p) => p.id === config.provider)?.label ?? config.provider,
                  date: new Date(config.updatedAt).toLocaleDateString(locale, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  }),
                })}
              </span>
              <button
                onClick={() => void handleRemove()}
                disabled={removing}
                className="text-danger hover:text-danger-hover font-medium text-sm ml-4 disabled:opacity-50"
              >
                {removing ? t('admin.aiSettings.org.removing') : t('admin.aiSettings.remove')}
              </button>
            </div>
          )}

          {removeError && <p className="text-sm text-danger mb-4">{removeError}</p>}

          <form
            onSubmit={(e) => void handleSave(e)}
            className="bg-surface border border-border rounded-xl p-6 space-y-5"
          >
            <div>
              <p className="text-sm font-medium text-foreground-secondary mb-3">
                {t('admin.aiSettings.provider')}
              </p>
              <div className="space-y-2">
                {PROVIDERS.map((p) => {
                  const hint = (models[p.id] ?? [])
                    .slice(0, 2)
                    .map((m) => m.label)
                    .join(' / ');
                  return (
                    <label
                      key={p.id}
                      htmlFor={`ai-provider-${p.id}`}
                      aria-label={t('admin.aiSettings.org.selectProviderAria', {
                        provider: p.label,
                      })}
                      className={[
                        'flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors',
                        selectedProvider === p.id
                          ? 'border-accent bg-accent/10'
                          : 'border-border hover:border-muted',
                      ].join(' ')}
                    >
                      <input
                        id={`ai-provider-${p.id}`}
                        type="radio"
                        name="provider"
                        value={p.id}
                        aria-label={p.label}
                        checked={selectedProvider === p.id}
                        onChange={() => handleProviderChange(p.id)}
                        className="accent-accent"
                      />
                      <div>
                        <p className="text-sm font-medium text-foreground">{p.label}</p>
                        {hint && <p className="text-xs text-muted">{hint}</p>}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <label className="block" htmlFor="model">
              <span className="block text-sm font-medium text-foreground-secondary mb-1">
                {t('admin.aiSettings.model')}
              </span>
              <select
                id="model"
                aria-label={t('admin.aiSettings.model')}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={providerModels.length === 0}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:opacity-50"
              >
                {providerModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.recommendedForToolUse
                      ? `${m.label} — ${t('admin.aiSettings.modelRecommended')}`
                      : m.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-muted">
                {t('admin.aiSettings.modelHint')}
              </span>
            </label>

            <label className="block" htmlFor="apiKey">
              <span className="block text-sm font-medium text-foreground-secondary mb-1">
                {t('admin.aiSettings.apiKey')}
              </span>
              <input
                id="apiKey"
                type="password"
                aria-label={t('admin.aiSettings.apiKey')}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  config
                    ? t('admin.aiSettings.org.apiKeyKeepPlaceholder')
                    : t('admin.aiSettings.apiKeyPlaceholder')
                }
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
              />
            </label>

            {saveError && <p className="text-danger text-sm">{saveError}</p>}

            <button
              type="submit"
              disabled={saving || !apiKey.trim()}
              className="bg-accent hover:bg-accent-hover text-accent-foreground font-semibold py-2 px-5 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? t('admin.aiSettings.org.saving') : t('admin.aiSettings.org.saveApiKey')}
            </button>
          </form>

          {config && (
            <div className="mt-6 space-y-3 rounded-xl border border-border bg-surface p-6">
              <p className="text-sm font-medium text-foreground-secondary">
                {t('admin.aiSettings.org.availability')}
              </p>
              <label className="flex items-center gap-3 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={!config.aiFeaturesDisabled}
                  onChange={(e) => void saveFlags({ aiFeaturesDisabled: !e.target.checked })}
                />
                {t('admin.aiSettings.org.enableAi')}
              </label>
              <label className="flex items-center gap-3 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={!config.organizerChatDisabled}
                  disabled={config.aiFeaturesDisabled}
                  onChange={(e) => void saveFlags({ organizerChatDisabled: !e.target.checked })}
                />
                {t('admin.aiSettings.org.enableChat')}
              </label>
              <p className="text-xs text-muted">{t('admin.aiSettings.org.availabilityHint')}</p>
            </div>
          )}
        </>
      )}

      {tab === 'usage' && (
        <div className="bg-surface border border-border rounded-xl p-6">
          <h2 className="mb-4 font-display text-lg font-semibold text-foreground">
            {t('admin.aiSettings.usageTitle')}
          </h2>
          <AiUsageView rollup={rollup} t={t} />
        </div>
      )}

      {tab === 'budget' && (
        <div className="bg-surface border border-border rounded-xl p-6">
          <h2 className="mb-4 font-display text-lg font-semibold text-foreground">
            {t('admin.aiSettings.budgetTitle')}
          </h2>
          <AiBudgetView
            budgetEur={config?.monthlyBudgetEur ?? null}
            spentEur={rollup?.total.costEur ?? 0}
            onSave={saveBudget}
            t={t}
            disabled={!config}
          />
        </div>
      )}
    </main>
  );
}
