'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

interface FighterRow {
  id: string;
  slug: string;
  display_name: string;
  given_name: string;
  family_name: string;
  club_id: string | null;
  country_code: string | null;
  hema_ratings_id: string | null;
  photo_url: string | null;
  bio: string | null;
  gender_category: string | null;
  merged_into_fighter_id?: string | null;
  deleted_at?: string | null;
}

interface MergeAuditEntry {
  id: string;
  actor_user_id: string | null;
  action: string;
  entity_id: string;
  created_at: string;
  payload_json: {
    source?: { id?: string; display_name?: string; slug?: string };
    target?: { id?: string; display_name?: string; slug?: string };
    reason?: string | null;
    moved?: {
      personIds?: string[];
      registrationIds?: string[];
      workshopInstructorIds?: string[];
    };
  };
}

function canRevert(createdAt: string, nowMs: number): boolean {
  return nowMs - new Date(createdAt).getTime() <= 30 * 24 * 60 * 60 * 1000;
}

function FighterCard({ label, fighter }: { label: string; fighter: FighterRow | null }) {
  return (
    <section className="border border-gray-200 rounded-lg p-4 min-h-64">
      <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">{label}</p>
      {!fighter ? (
        <p className="text-sm text-gray-400">No fighter selected.</p>
      ) : (
        <div>
          <div className="flex items-start gap-3">
            <div className="h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center text-sm font-semibold text-gray-500 overflow-hidden">
              {fighter.photo_url ? 'Photo' : fighter.display_name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h2 className="text-lg font-semibold">{fighter.display_name}</h2>
              <p className="text-xs font-mono text-gray-500">{fighter.id}</p>
              <p className="text-sm text-gray-500 mt-1">{fighter.slug}</p>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3 mt-5 text-sm">
            <div>
              <dt className="text-gray-400">Name</dt>
              <dd>
                {fighter.given_name} {fighter.family_name}
              </dd>
            </div>
            <div>
              <dt className="text-gray-400">Country</dt>
              <dd>{fighter.country_code ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-gray-400">HEMA Ratings</dt>
              <dd>{fighter.hema_ratings_id ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-gray-400">Gender category</dt>
              <dd>{fighter.gender_category ?? '-'}</dd>
            </div>
          </dl>
          {fighter.bio && <p className="text-sm text-gray-600 mt-4 line-clamp-4">{fighter.bio}</p>}
        </div>
      )}
    </section>
  );
}

export default function AdminFightersPage() {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [query, setQuery] = useState('');
  const [fighters, setFighters] = useState<FighterRow[]>([]);
  const [source, setSource] = useState<FighterRow | null>(null);
  const [target, setTarget] = useState<FighterRow | null>(null);
  const [reason, setReason] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [audits, setAudits] = useState<MergeAuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [nowMs, setNowMs] = useState<number | null>(null);

  const refreshAudits = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setNowMs(Date.now()), 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/fighters/merge/audit-log`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load merge audit log');
        setAudits((await res.json()) as MergeAuditEntry[]);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : 'Something went wrong');
        }
      });
    return () => controller.abort();
  }, [apiUrl, refreshKey]);

  async function searchFighters() {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    const res = await fetch(`${apiUrl}/api/v1/fighters?q=${encodeURIComponent(query.trim())}`, {
      credentials: 'include',
    });
    setLoading(false);
    if (!res.ok) {
      setError('Fighter search failed.');
      return;
    }
    setFighters((await res.json()) as FighterRow[]);
  }

  async function mergeFighters() {
    if (!source || !target) return;
    if (source.id === target.id) {
      setError('Source and target must be different fighters.');
      return;
    }
    if (confirmName !== source.display_name) {
      setError('Typed confirmation must match the source display name.');
      return;
    }

    const res = await fetch(`${apiUrl}/api/v1/fighters/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ sourceId: source.id, targetId: target.id, reason: reason.trim() }),
    });

    if (res.ok) {
      setSource(null);
      setTarget(null);
      setReason('');
      setConfirmName('');
      setFighters([]);
      refreshAudits();
      return;
    }

    const body = (await res.json().catch(() => ({}))) as { message?: string };
    setError(body.message ?? 'Merge failed.');
  }

  async function revertMerge(auditId: string) {
    if (!confirm('Revert this fighter merge?')) return;
    const res = await fetch(`${apiUrl}/api/v1/fighters/merge/${auditId}/revert`, {
      method: 'POST',
      credentials: 'include',
    });
    if (res.ok || res.status === 204) {
      refreshAudits();
      return;
    }
    setError('Merge revert failed.');
  }

  return (
    <main className="p-8">
      <div className="mb-2">
        <Link href="/admin" className="text-sm text-gray-500 hover:underline">
          Back to admin
        </Link>
      </div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Fighter Merge</h1>
        <p className="text-gray-500 text-sm mt-1">
          Merge duplicate global fighter profiles with 30-day undo.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      <section className="border border-gray-200 rounded-lg p-4 mb-6">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void searchFighters();
            }}
            placeholder="Search fighters by name"
            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 w-80"
          />
          <button
            onClick={() => {
              void searchFighters();
            }}
            disabled={loading}
            className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-md text-sm"
          >
            Search
          </button>
        </div>
        {fighters.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500">
                  <th className="py-2 pr-4">Fighter</th>
                  <th className="py-2 pr-4">HEMA Ratings</th>
                  <th className="py-2">Select</th>
                </tr>
              </thead>
              <tbody>
                {fighters.map((fighter) => (
                  <tr key={fighter.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 pr-4">
                      <p className="font-medium">{fighter.display_name}</p>
                      <p className="font-mono text-xs text-gray-500">{fighter.id}</p>
                    </td>
                    <td className="py-2 pr-4 text-gray-500">{fighter.hema_ratings_id ?? '-'}</td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => setSource(fighter)}
                          className="text-xs text-red-700 hover:underline"
                        >
                          Source
                        </button>
                        <button
                          onClick={() => setTarget(fighter)}
                          className="text-xs text-green-700 hover:underline"
                        >
                          Target
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2 mb-6">
        <FighterCard label="Source: profile to merge away" fighter={source} />
        <FighterCard label="Target: profile to keep" fighter={target} />
      </div>

      <section className="border border-gray-200 rounded-lg p-4 mb-8">
        <h2 className="text-base font-semibold mb-4">Confirm merge</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason"
            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
          />
          <input
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
            placeholder={source ? `Type: ${source.display_name}` : 'Select a source fighter first'}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
          />
        </div>
        <button
          onClick={() => {
            void mergeFighters();
          }}
          disabled={!source || !target || confirmName !== source?.display_name}
          className="mt-3 bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-md text-sm"
        >
          Merge source into target
        </button>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Recent merges</h2>
        {audits.length === 0 ? (
          <p className="text-gray-400 text-sm">No fighter merges yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500">
                  <th className="py-2 pr-4">Merge</th>
                  <th className="py-2 pr-4">Reason</th>
                  <th className="py-2 pr-4">Created</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {audits.map((audit) => (
                  <tr key={audit.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 pr-4">
                      <p>
                        {audit.payload_json.source?.display_name ??
                          audit.payload_json.source?.id ??
                          audit.entity_id}
                        {' -> '}
                        {audit.payload_json.target?.display_name ??
                          audit.payload_json.target?.id ??
                          '-'}
                      </p>
                      <p className="text-xs text-gray-500">
                        Persons {audit.payload_json.moved?.personIds?.length ?? 0}, registrations{' '}
                        {audit.payload_json.moved?.registrationIds?.length ?? 0}, instructors{' '}
                        {audit.payload_json.moved?.workshopInstructorIds?.length ?? 0}
                      </p>
                    </td>
                    <td className="py-2 pr-4 text-gray-600">{audit.payload_json.reason ?? '-'}</td>
                    <td className="py-2 pr-4 text-gray-500">
                      {new Date(audit.created_at).toLocaleDateString('fr-FR')}
                    </td>
                    <td className="py-2">
                      <button
                        onClick={() => {
                          void revertMerge(audit.id);
                        }}
                        disabled={nowMs === null || !canRevert(audit.created_at, nowMs)}
                        className="text-xs text-red-700 hover:underline disabled:text-gray-300"
                      >
                        Revert
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
