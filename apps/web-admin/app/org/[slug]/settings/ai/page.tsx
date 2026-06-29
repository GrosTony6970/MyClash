/* eslint-disable myclash/no-literal-string -- org AI settings, i18n tracked in backlog */
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useI18n } from '../../../../../src/i18n/I18nProvider';

type AIProvider = 'anthropic' | 'openai' | 'mistral';

interface AIConfig {
  provider: AIProvider;
  hasKey: true;
  updatedAt: string;
}

const PROVIDERS: { id: AIProvider; label: string; hint: string }[] = [
  { id: 'anthropic', label: 'Anthropic', hint: 'Claude 3.5 Sonnet / Haiku' },
  { id: 'openai', label: 'OpenAI', hint: 'GPT-4o / GPT-4o mini' },
  { id: 'mistral', label: 'Mistral', hint: 'Mistral Large / Small' },
];

export default function OrgAISettingsPage() {
  const params = useParams<{ slug: string }>();
  const { slug } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t } = useI18n();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [config, setConfig] = useState<AIConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/organizations/slug/${encodeURIComponent(slug)}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const org = (await res.json()) as { id: string };
        setOrgId(org.id);
        const cfgRes = await fetch(`${apiUrl}/api/v1/organizations/${org.id}/ai-settings`, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (cfgRes.ok) {
          const data = (await cfgRes.json()) as AIConfig | null;
          setConfig(data);
          if (data) setSelectedProvider(data.provider);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(t('admin.common.loadAiSettingsFailed'));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [slug, apiUrl, t]);

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
        body: JSON.stringify({ provider: selectedProvider, apiKey: apiKey.trim() }),
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

  if (loading) {
    return (
      <main className="p-8 max-w-2xl">
        <div className="flex items-center gap-2 text-muted text-sm">
          <span className="w-4 h-4 border-2 border-muted border-t-transparent rounded-full animate-spin" />
          Loading…
        </div>
      </main>
    );
  }

  return (
    <main className="p-8 max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-muted mb-1">
        <Link href={`/org/${slug}`} className="hover:text-foreground-secondary">
          {slug}
        </Link>
        <span>/</span>
        <Link href={`/org/${slug}/settings/ai`} className="hover:text-foreground-secondary">
          Settings
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">AI</span>
      </div>

      <h1 className="font-display font-bold text-2xl sm:text-3xl mb-1 mt-4">AI Settings</h1>
      <p className="text-muted text-sm mb-6">
        Connect an AI provider API key to enable AI-powered features for your organisation.
      </p>

      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 mb-6 text-sm">
          {error}
        </div>
      )}

      {!config && (
        <div className="bg-warning/10 border border-warning/30 text-warning rounded-lg px-4 py-3 mb-6 text-sm">
          AI features are disabled for your organisation until an API key is configured.
        </div>
      )}

      {config && (
        <div className="bg-success/10 border border-success/30 text-success rounded-lg px-4 py-3 mb-2 text-sm flex items-center justify-between">
          <span>
            <strong>{PROVIDERS.find((p) => p.id === config.provider)?.label}</strong> key saved —
            updated{' '}
            {new Date(config.updatedAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
          <button
            onClick={() => void handleRemove()}
            disabled={removing}
            className="text-danger hover:text-danger-hover font-medium text-sm ml-4 disabled:opacity-50"
          >
            {removing ? 'Removing…' : 'Remove key'}
          </button>
        </div>
      )}

      {removeError && <p className="text-sm text-danger mb-4">{removeError}</p>}

      <form
        onSubmit={(e) => void handleSave(e)}
        className="bg-surface border border-border rounded-xl p-6 space-y-5"
      >
        <div>
          <p className="text-sm font-medium text-foreground-secondary mb-3">Provider</p>
          <div className="space-y-2">
            {PROVIDERS.map((p) => (
              <label
                key={p.id}
                htmlFor={`ai-provider-${p.id}`}
                aria-label={`Select ${p.label} as AI provider`}
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
                  onChange={() => setSelectedProvider(p.id)}
                  className="accent-accent"
                />
                <div>
                  <p className="text-sm font-medium text-foreground">{p.label}</p>
                  <p className="text-xs text-muted">{p.hint}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        <label className="block" htmlFor="apiKey">
          <span className="block text-sm font-medium text-foreground-secondary mb-1">API Key</span>
          <input
            id="apiKey"
            type="password"
            aria-label="API key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={config ? '••••••••  (leave blank to keep current key)' : 'sk-ant-…'}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
          />
        </label>

        {saveError && <p className="text-danger text-sm">{saveError}</p>}

        <button
          type="submit"
          disabled={saving || !apiKey.trim()}
          className="bg-accent hover:bg-accent-hover text-accent-foreground font-semibold py-2 px-5 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save API key'}
        </button>
      </form>
    </main>
  );
}
