/* eslint-disable myclash/no-literal-string -- org AI settings, i18n tracked in backlog */
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

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
        setError('Failed to load AI settings');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [slug, apiUrl]);

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
        setSaveError('Failed to save API key');
        return;
      }
      const updated = (await res.json()) as AIConfig | null;
      setConfig(updated);
      setApiKey('');
    } catch {
      setSaveError('Failed to save API key');
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
      setRemoveError('Failed to remove key');
    } finally {
      setRemoving(false);
    }
  }

  if (loading) {
    return (
      <main className="p-8 max-w-2xl">
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <span className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
          Loading…
        </div>
      </main>
    );
  }

  return (
    <main className="p-8 max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
        <Link href={`/org/${slug}`} className="hover:text-gray-700">
          {slug}
        </Link>
        <span>/</span>
        <Link href={`/org/${slug}/settings/ai`} className="hover:text-gray-700">
          Settings
        </Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">AI</span>
      </div>

      <h1 className="text-2xl font-bold mb-1 mt-4">AI Settings</h1>
      <p className="text-gray-500 text-sm mb-6">
        Connect an AI provider API key to enable AI-powered features for your organisation.
      </p>

      <div className="flex gap-4 mb-6 border-b border-gray-200 pb-1">
        <Link
          href={`/org/${slug}/settings/compensation`}
          className="pb-2 text-sm font-medium text-gray-500 hover:text-gray-700"
        >
          Compensation
        </Link>
        <Link
          href={`/org/${slug}/settings/ai`}
          className="pb-2 text-sm font-medium border-b-2 border-red-600 text-red-700"
        >
          AI
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-6 text-sm">
          {error}
        </div>
      )}

      {!config && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 mb-6 text-sm">
          AI features are disabled for your organisation until an API key is configured.
        </div>
      )}

      {config && (
        <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-3 mb-2 text-sm flex items-center justify-between">
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
            className="text-red-600 hover:text-red-800 font-medium text-sm ml-4 disabled:opacity-50"
          >
            {removing ? 'Removing…' : 'Remove key'}
          </button>
        </div>
      )}

      {removeError && <p className="text-sm text-red-600 mb-4">{removeError}</p>}

      <form
        onSubmit={(e) => void handleSave(e)}
        className="bg-white border border-gray-200 rounded-xl p-6 space-y-5"
      >
        <div>
          <p className="text-sm font-medium text-gray-700 mb-3">Provider</p>
          <div className="space-y-2">
            {PROVIDERS.map((p) => (
              <label
                key={p.id}
                className={[
                  'flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors',
                  selectedProvider === p.id
                    ? 'border-red-400 bg-red-50'
                    : 'border-gray-200 hover:border-gray-300',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name="provider"
                  value={p.id}
                  checked={selectedProvider === p.id}
                  onChange={() => setSelectedProvider(p.id)}
                  className="accent-red-600"
                />
                <div>
                  <p className="text-sm font-medium text-gray-800">{p.label}</p>
                  <p className="text-xs text-gray-500">{p.hint}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="apiKey">
            API Key
          </label>
          <input
            id="apiKey"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={config ? '••••••••  (leave blank to keep current key)' : 'sk-ant-…'}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
          />
        </div>

        {saveError && <p className="text-red-600 text-sm">{saveError}</p>}

        <button
          type="submit"
          disabled={saving || !apiKey.trim()}
          className="bg-red-700 hover:bg-red-800 text-white font-semibold py-2 px-5 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save API key'}
        </button>
      </form>
    </main>
  );
}
