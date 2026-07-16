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
import { getPublicApiUrl } from '@/lib/api-url';
import { localeToBcp47 } from '@myclash/time';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useI18n } from '../../../../src/i18n/I18nProvider';

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

const STATUS_COLORS: Record<AssignmentStatus, string> = {
  assigned: 'bg-warning/10 text-warning border-warning/30',
  confirmed: 'bg-success/10 text-success border-success/30',
  declined: 'bg-danger/10 text-danger border-danger/30 opacity-60',
};

export default function RefereeDashboardPage() {
  const { t, locale } = useI18n();
  const params = useParams<{ eventSlug: string }>();
  const { eventSlug } = params;
  const apiUrl = getPublicApiUrl();

  const roleLabels: Record<string, string> = {
    arbitre_declarant: t('publicApp.fighterProfile.arbitreDeclarant'),
    arbitre_assesseur: t('publicApp.fighterProfile.arbitreAssesseur'),
    arbitre_table: t('publicApp.fighterProfile.arbitreTable'),
  };

  const statusLabels: Record<AssignmentStatus, string> = {
    assigned: t('publicApp.refereePublic.statusAssigned'),
    confirmed: t('publicApp.refereePublic.statusConfirmed'),
    declined: t('publicApp.refereePublic.statusDeclined'),
  };

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
        <span className="w-8 h-8 border-2 border-muted border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  return (
    <main className="px-4 py-6 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1
          className="font-display font-bold text-2xl sm:text-3xl"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--event-primary, #c0392b)' }}
        >
          {t('publicApp.refereePublic.dutiesTitle')}
        </h1>
        <Link
          href={`/e/${eventSlug}/my-schedule`}
          className="text-sm text-muted hover:text-foreground-secondary underline"
        >
          {t('publicApp.refereePublic.mySchedule')}
        </Link>
      </div>

      {assignments.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-4xl mb-3">🏛️</p>
          <p className="text-muted text-sm">{t('publicApp.refereePublic.noAssignments')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {assignments.map((a) => (
            <div
              key={a.id}
              className={[
                'border-2 rounded-xl p-4',
                a.status === 'declined' ? 'opacity-60' : '',
                a.status === 'confirmed' ? 'border-success/40' : 'border-border',
              ].join(' ')}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <p className="font-bold text-foreground">{a.poolName}</p>
                  <p
                    className="text-sm font-medium mt-0.5"
                    style={{ color: 'var(--event-primary, #c0392b)' }}
                  >
                    {roleLabels[a.role] ?? a.role}
                  </p>
                </div>
                <span
                  className={[
                    'text-xs px-2 py-0.5 rounded-full border font-medium',
                    STATUS_COLORS[a.status],
                  ].join(' ')}
                >
                  {statusLabels[a.status]}
                </span>
              </div>

              {/* Matches */}
              {a.matches.length > 0 && (
                <div className="flex flex-col gap-1.5 mb-3">
                  {a.matches.map((m) => (
                    <Link
                      key={m.id}
                      href={`/e/${eventSlug}/referee/match/${m.id}`}
                      className="flex items-center justify-between bg-background border border-border rounded-lg px-3 py-2 text-sm hover:border-muted transition-colors"
                    >
                      <div>
                        <p className="font-medium text-foreground">{m.matchNumberLabel}</p>
                        <p className="text-xs text-muted">
                          {m.redFighterName ?? '?'} {t('scoring.liveMatch.versus')}{' '}
                          {m.blueFighterName ?? '?'}
                        </p>
                      </div>
                      {m.scheduledAt && (
                        <p className="text-xs text-muted flex-shrink-0">
                          {new Date(m.scheduledAt).toLocaleTimeString(localeToBcp47(locale), {
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
                      {updating === a.id ? '…' : t('publicApp.refereePublic.confirm')}
                    </button>
                  )}
                  <button
                    onClick={() => void updateStatus(a.id, 'declined')}
                    disabled={updating === a.id}
                    className="flex-1 py-1.5 rounded-lg text-sm font-medium border border-border text-foreground-secondary hover:border-muted transition-colors disabled:opacity-50"
                  >
                    {t('publicApp.refereePublic.decline')}
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
