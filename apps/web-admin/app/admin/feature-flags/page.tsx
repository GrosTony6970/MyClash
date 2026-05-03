'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

interface FeatureFlag {
  key: string;
  description: string | null;
  enabled: boolean;
  payload_json: Record<string, unknown> | null;
  updated_at: string;
  updated_by_user_id: string | null;
}

interface DraftFlag {
  key: string;
  description: string;
  enabled: boolean;
  payloadText: string;
}

function toDraft(flag?: FeatureFlag): DraftFlag {
  return {
    key: flag?.key ?? '',
    description: flag?.description ?? '',
    enabled: flag?.enabled ?? false,
    payloadText: flag?.payload_json ? JSON.stringify(flag.payload_json, null, 2) : '',
  };
}

export default function AdminFeatureFlagsPage() {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [draft, setDraft] = useState<DraftFlag>(toDraft());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    fetch(`${apiUrl}/api/v1/admin/feature-flags`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          setError('Access denied. Super admin required.');
          setLoading(false);
          return;
        }
        if (!res.ok) throw new Error('Failed to load feature flags');
        const data = (await res.json()) as FeatureFlag[];
        if (!cancelled) {
          setFlags(data);
          setError(null);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : 'Something went wrong');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiUrl, refreshKey]);

  async function saveFlag(nextDraft: DraftFlag = draft) {
    const key = nextDraft.key.trim();
    if (!key) {
      setError('Feature flag key is required.');
      return;
    }

    let payload: Record<string, unknown> | undefined;
    if (nextDraft.payloadText.trim()) {
      try {
        const parsed = JSON.parse(nextDraft.payloadText) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setError('Payload must be a JSON object.');
          return;
        }
        payload = parsed as Record<string, unknown>;
      } catch {
        setError('Payload JSON is invalid.');
        return;
      }
    }

    setSaving(true);
    const res = await fetch(`${apiUrl}/api/v1/admin/feature-flags/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        description: nextDraft.description.trim() || undefined,
        enabled: nextDraft.enabled,
        payload,
      }),
    });

    setSaving(false);

    if (res.ok || res.status === 204) {
      setDraft(toDraft());
      refresh();
      return;
    }

    setError('Failed to save feature flag.');
  }

  async function deleteFlag(key: string) {
    if (!confirm(`Delete feature flag ${key}?`)) return;

    const res = await fetch(`${apiUrl}/api/v1/admin/feature-flags/${encodeURIComponent(key)}`, {
      method: 'DELETE',
      credentials: 'include',
    });

    if (res.ok || res.status === 204) {
      refresh();
      return;
    }

    setError('Failed to delete feature flag.');
  }

  return (
    <main className="p-8">
      <div className="mb-2">
        <Link href="/admin" className="text-sm text-gray-500 hover:underline">
          Back to admin
        </Link>
      </div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Feature Flags</h1>
        <p className="text-gray-500 text-sm mt-1">Platform-wide switches and JSON payloads.</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      <section className="border border-gray-200 rounded-lg p-4 mb-6">
        <h2 className="text-base font-semibold mb-4">Edit flag</h2>
        <div className="grid gap-3 lg:grid-cols-[220px_1fr_120px]">
          <input
            value={draft.key}
            onChange={(e) => setDraft((current) => ({ ...current, key: e.target.value }))}
            placeholder="flag-key"
            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
          />
          <input
            value={draft.description}
            onChange={(e) => setDraft((current) => ({ ...current, description: e.target.value }))}
            placeholder="Description"
            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
          />
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => setDraft((current) => ({ ...current, enabled: e.target.checked }))}
              className="h-4 w-4"
            />
            Enabled
          </label>
        </div>
        <textarea
          value={draft.payloadText}
          onChange={(e) => setDraft((current) => ({ ...current, payloadText: e.target.value }))}
          placeholder='{"cohort":"internal"}'
          className="mt-3 w-full min-h-28 border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-600"
        />
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => {
              void saveFlag();
            }}
            disabled={saving}
            className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-md text-sm"
          >
            Save flag
          </button>
          <button
            onClick={() => setDraft(toDraft())}
            className="border border-gray-300 hover:bg-gray-50 py-2 px-4 rounded-md text-sm"
          >
            Clear
          </button>
        </div>
      </section>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : flags.length === 0 ? (
        <p className="text-gray-400 text-sm">No feature flags configured.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-2 pr-4">Key</th>
                <th className="py-2 pr-4">Description</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Updated</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((flag) => (
                <tr key={flag.key} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 pr-4 font-mono text-xs">{flag.key}</td>
                  <td className="py-2 pr-4 text-gray-600">{flag.description ?? '-'}</td>
                  <td className="py-2 pr-4">
                    <button
                      onClick={() => {
                        void saveFlag({
                          key: flag.key,
                          description: flag.description ?? '',
                          enabled: !flag.enabled,
                          payloadText: flag.payload_json
                            ? JSON.stringify(flag.payload_json, null, 2)
                            : '',
                        });
                      }}
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        flag.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {flag.enabled ? 'enabled' : 'disabled'}
                    </button>
                  </td>
                  <td className="py-2 pr-4 text-gray-500">
                    {new Date(flag.updated_at).toLocaleDateString('fr-FR')}
                  </td>
                  <td className="py-2">
                    <div className="flex gap-2">
                      <button
                        onClick={() => setDraft(toDraft(flag))}
                        className="text-xs text-red-700 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          void deleteFlag(flag.key);
                        }}
                        className="text-xs text-gray-500 hover:text-red-700 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
