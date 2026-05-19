'use client';

import { t } from '@myclash/i18n';
import { useEffect, useState } from 'react';

type AIProvider = 'anthropic' | 'openai' | 'mistral';

interface PlatformAISettings {
  provider: AIProvider;
  hasKey: true;
  updatedAt: string;
}

export default function AdminAISettingsPage() {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const [settings, setSettings] = useState<PlatformAISettings | null>(null);
  const [provider, setProvider] = useState<AIProvider>('openai');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${apiUrl}/api/v1/admin/ai-settings`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.status === 404 || res.status === 204) return null;
        if (res.status === 401 || res.status === 403) {
          throw new Error(t('admin.aiSettings.accessDenied'));
        }
        if (!res.ok) throw new Error(t('admin.aiSettings.loadError'));
        return (await res.json()) as PlatformAISettings | null;
      })
      .then((data) => {
        setSettings(data);
        if (data?.provider) setProvider(data.provider);
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

  async function saveSettings() {
    setSaving(true);
    setMessage(null);
    setError(null);
    const res = await fetch(`${apiUrl}/api/v1/admin/ai-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ provider, apiKey }),
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
    if (!confirm(t('admin.aiSettings.removeConfirm'))) return;
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

  return (
    <main className="p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t('admin.aiSettings.title')}</h1>
        <p className="text-slate-500 text-sm mt-1">{t('admin.aiSettings.description')}</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}
      {message && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-md px-4 py-3 mb-4 text-sm">
          {message}
        </div>
      )}

      <section className="border border-slate-200 rounded-lg p-5">
        <div className="mb-5 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {loading
            ? t('common.loading')
            : settings
              ? t('admin.aiSettings.currentKey', {
                  provider: settings.provider,
                  date: new Date(settings.updatedAt).toLocaleString('fr-FR'),
                })
              : t('admin.aiSettings.noKey')}
        </div>

        <label
          htmlFor="platform-ai-provider"
          className="block text-sm font-medium text-slate-700 mb-2"
        >
          {t('admin.aiSettings.provider')}
        </label>
        <select
          id="platform-ai-provider"
          aria-label={t('admin.aiSettings.provider')}
          value={provider}
          onChange={(event) => setProvider(event.target.value as AIProvider)}
          className="mb-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-800/30"
        >
          <option value="openai">{t('admin.aiSettings.providers.openai')}</option>
          <option value="anthropic">{t('admin.aiSettings.providers.anthropic')}</option>
          <option value="mistral">{t('admin.aiSettings.providers.mistral')}</option>
        </select>

        <label htmlFor="platform-ai-key" className="block text-sm font-medium text-slate-700 mb-2">
          {t('admin.aiSettings.apiKey')}
        </label>
        <input
          id="platform-ai-key"
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={t('admin.aiSettings.apiKeyPlaceholder')}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-800/30"
        />

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              void saveSettings();
            }}
            disabled={saving || apiKey.trim().length < 10}
            className="bg-red-800 hover:bg-red-900 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-md text-sm"
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
              className="border border-slate-300 hover:bg-slate-50 disabled:opacity-50 py-2 px-4 rounded-md text-sm"
            >
              {t('admin.aiSettings.remove')}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
