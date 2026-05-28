'use client';

/* eslint-disable myclash/no-literal-string */

/**
 * Super-admin queue for global-person claim requests submitted from
 * /me when the target profile has no email on file (the §8 fallback
 * to the §3 magic-link confirm path).
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

interface GlobalPersonPreview {
  id: string;
  displayName: string;
  givenName: string;
  familyName: string;
  countryCode: string | null;
  hemaRatingsId: string | null;
  clubLabel: string | null;
}

interface PendingRequest {
  id: string;
  userId: string;
  requesterEmail: string | null;
  requestedAt: string;
  globalPerson: GlobalPersonPreview | null;
}

export default function PendingClaimsPage() {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const [rows, setRows] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/global-person-claim-requests`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('list');
      setRows((await res.json()) as PendingRequest[]);
    } catch {
      setError('Could not load pending claim requests.');
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/global-person-claim-requests/${id}/approve`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'approve failed');
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    if (!rejectReason.trim()) {
      setError('Enter a rejection reason.');
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/global-person-claim-requests/${id}/reject`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'reject failed');
      }
      setRejectingId(null);
      setRejectReason('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="p-8 max-w-6xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold mb-1">Profile claim requests</h1>
          <p className="text-slate-500 text-sm">
            Public users asking to claim a global profile that has no email on file. Approve to set{' '}
            <code>claimed_by_user_id</code> + backfill the email; reject with a reason to leave the
            profile unclaimed.
          </p>
        </div>
        <Link href="/admin/global-persons/import" className="text-sm text-blue-700 hover:underline">
          ← Global persons
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">No pending requests.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Requester</th>
                <th className="px-3 py-2">Profile</th>
                <th className="px-3 py-2">Club</th>
                <th className="px-3 py-2">Requested</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 align-top">
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs text-slate-700">
                      {row.requesterEmail ?? row.userId}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {row.globalPerson ? (
                      <div>
                        <div className="font-semibold">{row.globalPerson.displayName}</div>
                        <div className="text-xs text-slate-500">
                          {[
                            row.globalPerson.countryCode,
                            row.globalPerson.hemaRatingsId
                              ? `HEMA #${row.globalPerson.hemaRatingsId}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 italic">missing profile</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {row.globalPerson?.clubLabel ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {new Date(row.requestedAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {rejectingId === row.id ? (
                      <div className="flex flex-col gap-2 items-end">
                        <input
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder="Rejection reason"
                          className="w-56 border border-slate-300 rounded px-2 py-1 text-xs"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void reject(row.id)}
                            disabled={busyId === row.id || !rejectReason.trim()}
                            className="rounded bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold px-3 py-1"
                          >
                            Confirm reject
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRejectingId(null);
                              setRejectReason('');
                            }}
                            className="rounded border border-slate-300 text-xs px-3 py-1"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2 justify-end">
                        <button
                          type="button"
                          onClick={() => void approve(row.id)}
                          disabled={busyId === row.id}
                          className="rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold px-3 py-1"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => setRejectingId(row.id)}
                          disabled={busyId === row.id}
                          className="rounded border border-slate-300 text-slate-700 text-xs font-bold px-3 py-1 hover:bg-slate-50"
                        >
                          Reject
                        </button>
                      </div>
                    )}
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
