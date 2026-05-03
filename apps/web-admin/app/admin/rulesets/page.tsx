'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type RulesetStatus = 'pending' | 'approved' | 'rejected';

interface RulesetSubmission {
  id: string;
  code: string;
  version: string;
  display_name: string;
  description: string | null;
  submitted_by_user_id: string | null;
  package_ref: string | null;
  status: RulesetStatus;
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

export default function AdminRulesetsPage() {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [rulesets, setRulesets] = useState<RulesetSubmission[]>([]);
  const [status, setStatus] = useState<'all' | RulesetStatus>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (status !== 'all') params.set('status', status);

    fetch(`${apiUrl}/api/v1/admin/rulesets?${params}`, {
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
        if (!res.ok) throw new Error('Failed to load rulesets');
        const data = (await res.json()) as RulesetSubmission[];
        if (!cancelled) {
          setRulesets(data);
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
  }, [apiUrl, status, refreshKey]);

  async function handleRulesetAction(id: string, action: 'approve' | 'reject') {
    let body: BodyInit | undefined;
    const headers: HeadersInit = {};

    if (action === 'reject') {
      const reason = prompt('Reason for rejection:');
      if (!reason?.trim()) return;
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify({ reason: reason.trim() });
    }

    const res = await fetch(`${apiUrl}/api/v1/admin/rulesets/${id}/${action}`, {
      method: 'PATCH',
      headers,
      credentials: 'include',
      body,
    });

    if (res.ok || res.status === 204) {
      refresh();
      return;
    }

    alert('Action failed. Please try again.');
  }

  return (
    <main className="p-8">
      <div className="mb-2">
        <Link href="/admin" className="text-sm text-gray-500 hover:underline">
          Back to admin
        </Link>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Rulesets</h1>
          <p className="text-gray-500 text-sm mt-1">
            Approve reviewed ruleset metadata. Runtime code is never executed here.
          </p>
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
        >
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All statuses</option>
        </select>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : rulesets.length === 0 ? (
        <p className="text-gray-400 text-sm">No ruleset submissions found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-2 pr-4">Ruleset</th>
                <th className="py-2 pr-4">Package</th>
                <th className="py-2 pr-4">Submitted by</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Created</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rulesets.map((ruleset) => (
                <tr key={ruleset.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 pr-4">
                    <p className="font-medium">{ruleset.display_name}</p>
                    <p className="font-mono text-xs text-gray-500">
                      {ruleset.code}@{ruleset.version}
                    </p>
                    {ruleset.description && (
                      <p className="text-xs text-gray-500 mt-1 max-w-xl">{ruleset.description}</p>
                    )}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-gray-500">
                    {ruleset.package_ref ?? '-'}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-gray-500">
                    {ruleset.submitted_by_user_id ?? '-'}
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        ruleset.status === 'approved'
                          ? 'bg-green-100 text-green-700'
                          : ruleset.status === 'rejected'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-yellow-100 text-yellow-700'
                      }`}
                    >
                      {ruleset.status}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-gray-500">
                    {new Date(ruleset.created_at).toLocaleDateString('fr-FR')}
                  </td>
                  <td className="py-2">
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          void handleRulesetAction(ruleset.id, 'approve');
                        }}
                        className="text-xs text-green-700 hover:underline disabled:text-gray-300"
                        disabled={ruleset.status === 'approved'}
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => {
                          void handleRulesetAction(ruleset.id, 'reject');
                        }}
                        className="text-xs text-red-700 hover:underline disabled:text-gray-300"
                        disabled={ruleset.status === 'rejected'}
                      >
                        Reject
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
