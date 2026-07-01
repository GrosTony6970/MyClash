'use client';

import { t } from '@myclash/i18n';
import { useConfirm } from '@myclash/ui';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../src/i18n/I18nProvider';
import { AiUsageView, type UsageRollup } from '../../../src/components/ai/AiUsageView';
import { AiBudgetView } from '../../../src/components/ai/AiBudgetView';

type AIProvider = 'anthropic' | 'openai' | 'mistral';
type Tab = 'keys' | 'usage' | 'budget';

interface ModelOption {
  id: string;
  label: string;
  isDefault: boolean;
  recommendedForToolUse: boolean;
  supportsTemperature: boolean;
}

interface PlatformAISettings {
  provider: AIProvider;
  hasKey: true;
  model: string | null;
  monthlyBudgetEur: number | null;
  updatedAt: string;
}

const TABS: { id: Tab; key: string }[] = [
  { id: 'keys', key: 'admin.aiSettings.tabKeys' },
  { id: 'usage', key: 'admin.aiSettings.tabUsage' },
  { id: 'budget', key: 'admin.aiSettings.tabBudget' },
];

function defaultModelId(options: ModelOption[]): string {
  return options.find((m) => m.isDefault)?.id ?? options[0]?.id ?? '';
}

export default function AdminAISettingsPage() {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const [settings, setSettings] = useState<PlatformAISettings | null>(null);
  const [provider, setProvider] = useState<AIProvider>('openai');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState<string>('');
  const [models, setModels] = useState<Record<AIProvider, ModelOption[]>>({
    anthropic: [],
    openai: [],
    mistral: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('keys');
  const [rollup, setRollup] = useState<UsageRollup | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const { locale } = useI18n();

  useEffect(() => {
    const controller = new AbortController();

    Promise.all([
      fetch(`${apiUrl}/api/v1/ai/models`, { credentials: 'include', signal: controller.signal })
        .then((res) => (res.ok ? (res.json() as Promise<Record<AIProvider, ModelOption[]>>) : null))
        .catch(() => null),
      fetch(`${apiUrl}/api/v1/admin/ai-settings`, {
        credentials: 'include',
        signal: controller.signal,
      }).then(async (res) => {
        if (res.status === 404 || res.status === 204) return null;
        if (res.status === 401 || res.status === 403) {
          throw new Error(t('admin.aiSettings.accessDenied'));
        }
        if (!res.ok) throw new Error(t('admin.aiSettings.loadError'));
        return (await res.json()) as PlatformAISettings | null;
      }),
      fetch(`${apiUrl}/api/v1/admin/ai-usage/summary`, {
        credentials: 'include',
        signal: controller.signal,
      })
        .then((res) => (res.ok ? (res.json() as Promise<UsageRollup>) : null))
        .catch(() => null),
    ])
      .then(([modelData, data, usage]) => {
        if (modelData) setModels(modelData);
        setSettings(data);
        const nextProvider = data?.provider ?? 'openai';
        setProvider(nextProvider);
        setModel(data?.model ?? defaultModelId(modelData?.[nextProvider] ?? []));
        if (usage) setRollup(usage);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : t('admin.aiSettings.loadError'));
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [apiUrl]);

  async function refreshRollup() {
    const res = await fetch(`${apiUrl}/api/v1/admin/ai-usage/summary`, { credentials: 'include' });
    if (res.ok) setRollup((await res.json()) as UsageRollup);
  }

  function handleProviderChange(next: AIProvider) {
    setProvider(next);
    const providerModels = models[next] ?? [];
    setModel((prev) =>
      providerModels.some((m) => m.id === prev) ? prev : defaultModelId(providerModels),
    );
  }

  async function saveSettings() {
    setSaving(true);
    setMessage(null);
    setError(null);
    const res = await fetch(`${apiUrl}/api/v1/admin/ai-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ provider, apiKey, model: model || null }),
    });
    setSaving(false);
    if (!res.ok) {
      setError(t('admin.aiSettings.saveError'));
      return;
    }
    setApiKey('');
    setSettings((await res.json()) as PlatformAISettings);
    setMessage(t('admin.aiSettings.saveSuccess'));
  }

  async function removeSettings() {
    if (!(await confirm({ title: t('admin.aiSettings.removeConfirm'), danger: true }))) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    const res = await fetch(`${apiUrl}/api/v1/admin/ai-settings`, {
      method: 'DELETE',
      credentials: 'include',
    });
    setSaving(false);
    if (!res.ok && res.status !== 204) {
      setError(t('admin.aiSettings.removeError'));
      return;
    }
    setSettings(null);
    setApiKey('');
    setMessage(t('admin.aiSettings.removeSuccess'));
  }

  async function saveBudget(value: number | null) {
    const res = await fetch(`${apiUrl}/api/v1/admin/ai-settings/budget`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ monthlyBudgetEur: value }),
    });
    if (!res.ok) throw new Error(t('admin.aiSettings.budgetError'));
    setSettings((await res.json()) as PlatformAISettings);
    await refreshRollup();
  }

  const providerModels = models[provider] ?? [];

  return (
    <main className="p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="font-display font-bold text-2xl sm:text-3xl">
          {t('admin.aiSettings.title')}
        </h1>
        <p className="text-muted text-sm mt-1">{t('admin.aiSettings.description')}</p>
      </div>

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
        <div className="bg-danger/10 border border-danger/30 text-danger rounded-md px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}
      {message && (
        <div className="bg-success/10 border border-success/30 text-success rounded-md px-4 py-3 mb-4 text-sm">
          {message}
        </div>
      )}

      {tab === 'keys' && (
        <section className="border border-border rounded-lg p-5">
          <div className="mb-5 rounded-md border border-border bg-background px-4 py-3 text-sm text-foreground-secondary">
            {loading
              ? t('common.loading')
              : settings
                ? t('admin.aiSettings.currentKey', {
                    provider: settings.provider,
                    date: new Date(settings.updatedAt).toLocaleString(locale),
                  })
                : t('admin.aiSettings.noKey')}
          </div>

          <label
            htmlFor="platform-ai-provider"
            className="block text-sm font-medium text-foreground-secondary mb-2"
          >
            {t('admin.aiSettings.provider')}
          </label>
          <select
            id="platform-ai-provider"
            aria-label={t('admin.aiSettings.provider')}
            value={provider}
            onChange={(event) => handleProviderChange(event.target.value as AIProvider)}
            className="mb-4 w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          >
            <option value="openai">{t('admin.aiSettings.providers.openai')}</option>
            <option value="anthropic">{t('admin.aiSettings.providers.anthropic')}</option>
            <option value="mistral">{t('admin.aiSettings.providers.mistral')}</option>
          </select>

          <label
            htmlFor="platform-ai-model"
            className="block text-sm font-medium text-foreground-secondary mb-2"
          >
            {t('admin.aiSettings.model')}
          </label>
          <select
            id="platform-ai-model"
            aria-label={t('admin.aiSettings.model')}
            value={model}
            onChange={(event) => setModel(event.target.value)}
            disabled={providerModels.length === 0}
            className="mb-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
          >
            {providerModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.recommendedForToolUse
                  ? `${m.label} — ${t('admin.aiSettings.modelRecommended')}`
                  : m.label}
              </option>
            ))}
          </select>
          <p className="mb-4 text-xs text-muted">{t('admin.aiSettings.modelHint')}</p>

          <label
            htmlFor="platform-ai-key"
            className="block text-sm font-medium text-foreground-secondary mb-2"
          >
            {t('admin.aiSettings.apiKey')}
          </label>
          <input
            id="platform-ai-key"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={t('admin.aiSettings.apiKeyPlaceholder')}
            className="w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          />

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                void saveSettings();
              }}
              disabled={saving || apiKey.trim().length < 10}
              className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-md text-sm"
            >
              {saving ? t('admin.aiSettings.saving') : t('admin.aiSettings.save')}
            </button>
            {settings && (
              <button
                type="button"
                onClick={() => {
                  void removeSettings();
                }}
                disabled={saving}
                className="border border-border hover:bg-background disabled:opacity-50 py-2 px-4 rounded-md text-sm"
              >
                {t('admin.aiSettings.remove')}
              </button>
            )}
          </div>
        </section>
      )}

      {tab === 'usage' && (
        <section className="border border-border rounded-lg p-5">
          <h2 className="mb-4 font-display text-lg font-semibold text-foreground">
            {t('admin.aiSettings.usageTitle')}
          </h2>
          <AiUsageView rollup={rollup} t={t} />
        </section>
      )}

      {tab === 'budget' && (
        <section className="border border-border rounded-lg p-5">
          <h2 className="mb-4 font-display text-lg font-semibold text-foreground">
            {t('admin.aiSettings.budgetTitle')}
          </h2>
          <AiBudgetView
            budgetEur={settings?.monthlyBudgetEur ?? null}
            spentEur={rollup?.total.costEur ?? 0}
            onSave={saveBudget}
            t={t}
            disabled={!settings}
          />
        </section>
      )}
      {confirmDialog}
    </main>
  );
}
