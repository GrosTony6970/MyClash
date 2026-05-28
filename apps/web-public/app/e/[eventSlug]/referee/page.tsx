'use client';

/**
 * Referee dashboard — T-909
 * Route: /e/[eventSlug]/referee
 *
 * AC:
 *   ✓ Shows assigned pools (with role) and matches
 *   ✓ Confirm/decline buttons per assignment
 *   ✓ Visible on My Schedule with role label
 */

import { useEffect, useState } from 'react';
import { getApiUrl } from '@/lib/api-url';
import { useParams } from 'next/navigation';
import Link from 'next/link';

type AssignmentStatus = 'assigned' | 'confirmed' | 'declined';

interface RefereeAssignment {
  id: string;
  poolId: string;
  poolName: string;
  role: string;
  status: AssignmentStatus;
  autoAssigned: boolean;
  matches: Array<{
    id: string;
    matchNumberLabel: string;
    scheduledAt: string | null;
    redFighterName: string | null;
    blueFighterName: string | null;
  }>;
}

const ROLE_LABELS: Record<string, string> = {
  arbitre_declarant: 'Arbitre déclarant',
  arbitre_assesseur: 'Arbitre assesseur',
  arbitre_table: 'Arbitre de table',
};

const STATUS_COLORS: Record<AssignmentStatus, string> = {
  assigned: 'bg-yellow-100 text-yellow-700 border-yellow-300',
  confirmed: 'bg-green-100 text-green-700 border-green-300',
  declined: 'bg-red-100 text-red-500 border-red-200 opacity-60',
};

export default function RefereeDashboardPage() {
  const params = useParams<{ eventSlug: string }>();
  const { eventSlug } = params;
  const apiUrl = getApiUrl();

  const [assignments, setAssignments] = useState<RefereeAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/events/${eventSlug}/my-referee-assignments`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        setLoading(false);
        if (res.ok) setAssignments((await res.json()) as RefereeAssignment[]);
      })
      .catch((err: unknown) => {
        setLoading(false);
        if (err instanceof Error && err.name === 'AbortError') return;
      });
    return () => controller.abort();
  }, [eventSlug, apiUrl]);

  async function updateStatus(assignmentId: string, status: 'confirmed' | 'declined') {
    setUpdating(assignmentId);
    try {
      const res = await fetch(`${apiUrl}/api/v1/referee-assignments/${assignmentId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setAssignments((prev) => prev.map((a) => (a.id === assignmentId ? { ...a, status } : a)));
      }
    } finally {
      setUpdating(null);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="w-8 h-8 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  return (
    <main className="px-4 py-6 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1
          className="text-2xl font-bold"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--event-primary, #c0392b)' }}
        >
          My Referee Duties
        </h1>
        <Link
          href={`/e/${eventSlug}/my-schedule`}
          className="text-sm text-gray-500 hover:text-gray-700 underline"
        >
          My Schedule
        </Link>
      </div>

      {assignments.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-4xl mb-3">🏛️</p>
          <p className="text-gray-400 text-sm">
            No referee assignments yet. Check back once the organizer assigns referees.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {assignments.map((a) => (
            <div
              key={a.id}
              className={[
                'border-2 rounded-xl p-4',
                a.status === 'declined' ? 'opacity-60' : '',
                a.status === 'confirmed' ? 'border-green-300' : 'border-gray-200',
              ].join(' ')}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <p className="font-bold text-gray-900">{a.poolName}</p>
                  <p
                    className="text-sm font-medium mt-0.5"
                    style={{ color: 'var(--event-primary, #c0392b)' }}
                  >
                    {ROLE_LABELS[a.role] ?? a.role}
                  </p>
                </div>
                <span
                  className={[
                    'text-xs px-2 py-0.5 rounded-full border font-medium',
                    STATUS_COLORS[a.status],
                  ].join(' ')}
                >
                  {a.status}
                </span>
              </div>

              {/* Matches */}
              {a.matches.length > 0 && (
                <div className="flex flex-col gap-1.5 mb-3">
                  {a.matches.map((m) => (
                    <Link
                      key={m.id}
                      href={`/e/${eventSlug}/referee/match/${m.id}`}
                      className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-sm hover:border-gray-300 transition-colors"
                    >
                      <div>
                        <p className="font-medium text-gray-900">{m.matchNumberLabel}</p>
                        <p className="text-xs text-gray-500">
                          {m.redFighterName ?? '?'} vs {m.blueFighterName ?? '?'}
                        </p>
                      </div>
                      {m.scheduledAt && (
                        <p className="text-xs text-gray-400 flex-shrink-0">
                          {new Date(m.scheduledAt).toLocaleTimeString('fr-FR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      )}
                    </Link>
                  ))}
                </div>
              )}

              {/* Confirm / Decline */}
              {a.status !== 'declined' && (
                <div className="flex gap-2">
                  {a.status !== 'confirmed' && (
                    <button
                      onClick={() => void updateStatus(a.id, 'confirmed')}
                      disabled={updating === a.id}
                      className="flex-1 py-1.5 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50"
                      style={{ backgroundColor: 'var(--event-primary, #c0392b)' }}
                    >
                      {updating === a.id ? '…' : 'Confirm'}
                    </button>
                  )}
                  <button
                    onClick={() => void updateStatus(a.id, 'declined')}
                    disabled={updating === a.id}
                    className="flex-1 py-1.5 rounded-lg text-sm font-medium border border-gray-300 text-gray-600 hover:border-gray-400 transition-colors disabled:opacity-50"
                  >
                    Decline
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
