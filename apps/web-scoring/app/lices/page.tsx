'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '../../src/i18n/I18nProvider';
import { getApiUrl } from '../../src/lib/api-url';

interface LiceAssignment {
  liceId: string;
  liceName: string;
  eventName: string;
  tournamentName: string;
  currentMatchId: string | null;
}

export default function LicePickerPage() {
  const router = useRouter();
  const { t } = useI18n();
  const apiUrl = getApiUrl();

  const [assignments, setAssignments] = useState<LiceAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  // Shared scoring tablets rotate between staff at multi-day events — without
  // an explicit logout the staff PIN session lived until cookie expiry.
  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch(`${apiUrl}/api/v1/staff-auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Network failure — still return to login; the cookie stays server-bound.
    }
    router.replace('/login');
  }

  useEffect(() => {
    void (async () => {
      try {
        const staffMeRes = await fetch(`${apiUrl}/api/v1/staff-auth/me`, {
          credentials: 'include',
        });

        if (!staffMeRes.ok) {
          const meRes = await fetch(`${apiUrl}/api/v1/me`, { credentials: 'include' });
          const me = (await meRes.json()) as { type: string };
          if (me.type !== 'user') {
            router.replace('/login');
            return;
          }
        }

        const assignmentsRes = await fetch(`${apiUrl}/api/v1/staff/assigned-lices`, {
          credentials: 'include',
        });
        if (!assignmentsRes.ok) {
          router.replace('/login');
          return;
        }

        const lices = (await assignmentsRes.json()) as Array<{
          id: string;
          name: string;
          event?: { name?: string };
          currentMatch?: { id?: string; tournamentName?: string | null };
        }>;
        setAssignments(
          lices.map((lice) => ({
            liceId: lice.id,
            liceName: lice.name,
            eventName: lice.event?.name ?? '',
            tournamentName: lice.currentMatch?.tournamentName ?? '',
            currentMatchId: lice.currentMatch?.id ?? null,
          })),
        );
      } catch {
        setError(t('scoring.lice.loadAssignmentsError'));
      } finally {
        setLoading(false);
      }
    })();
  }, [apiUrl, router, t]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-gray-400">{t('scoring.lice.loadingAssignments')}</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-sm text-gray-400 hover:text-white underline"
          >
            {t('scoring.lice.retry')}
          </button>
        </div>
      </main>
    );
  }

  if (assignments.length === 0) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <h1 className="text-xl font-bold mb-2">{t('scoring.lice.noAssignedTitle')}</h1>
          <p className="text-gray-400 text-sm">{t('scoring.lice.noAssignedDescription')}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('scoring.lice.yourLices')}</h1>
          <p className="text-gray-400 text-sm mt-1">{t('scoring.lice.selectLice')}</p>
        </div>
        <button
          onClick={() => void handleLogout()}
          disabled={loggingOut}
          className="text-sm text-gray-400 hover:text-white underline disabled:opacity-50"
        >
          {t('scoring.lice.logout')}
        </button>
      </header>

      <div className="grid gap-4 max-w-lg">
        {assignments.map((assignment) => (
          <button
            key={assignment.liceId}
            onClick={() => router.push(`/lices/${assignment.liceId}`)}
            className="bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl p-5 text-left transition-colors"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">{assignment.liceName}</h2>
                <p className="text-gray-400 text-sm">
                  {[assignment.tournamentName, assignment.eventName].filter(Boolean).join(' - ')}
                </p>
              </div>
              {assignment.currentMatchId ? (
                <span className="bg-red-700 text-white text-xs font-bold px-2 py-1 rounded-full animate-pulse">
                  {t('scoring.lice.live')}
                </span>
              ) : (
                <span className="text-gray-500 text-sm">-&gt;</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </main>
  );
}
