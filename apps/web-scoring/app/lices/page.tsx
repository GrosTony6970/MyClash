'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '../../src/i18n/I18nProvider';
import { useScoringTheme } from '../../src/theme/ThemeProvider';
import { ThemeSwitcher } from '../../src/theme/ThemeSwitcher';
import { api } from '../../src/lib/api';

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
  // Chrome, like /lices/[liceId]. This page used to carry NO data-theme and so
  // inherited the pad scope from <body> — which is why tapping through to the
  // per-lice list flashed from dark to light (known-deviations D9).
  const { chromeScope } = useScoringTheme();
  // Every branch below is the same screen in a different state, so they must
  // all render in the same scope or the page changes surface while it loads.
  const shellClass = 'min-h-screen bg-background text-foreground';

  const [assignments, setAssignments] = useState<LiceAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  // Shared scoring tablets rotate between staff at multi-day events — without
  // an explicit logout the staff PIN session lived until cookie expiry.
  async function handleLogout() {
    setLoggingOut(true);
    try {
      await api.post('/api/v1/staff-auth/logout');
    } catch {
      // Network failure — still return to login; the cookie stays server-bound.
    }
    router.replace('/login');
  }

  useEffect(() => {
    void (async () => {
      try {
        // Staff PIN session, or fall back to a full-user session.
        try {
          await api.get('/api/v1/staff-auth/me');
        } catch {
          const me = await api.get<{ type: string }>('/api/v1/me').catch(() => null);
          if (me?.type !== 'user') {
            router.replace('/login');
            return;
          }
        }

        let lices: Array<{
          id: string;
          name: string;
          event?: { name?: string };
          currentMatch?: { id?: string; tournamentName?: string | null };
        }>;
        try {
          lices = await api.get('/api/v1/staff/assigned-lices');
        } catch {
          router.replace('/login');
          return;
        }
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
  }, [router, t]);

  if (loading) {
    return (
      <main data-theme={chromeScope} className={`flex items-center justify-center ${shellClass}`}>
        <p className="text-muted">{t('scoring.lice.loadingAssignments')}</p>
      </main>
    );
  }

  if (error) {
    return (
      <main
        data-theme={chromeScope}
        className={`flex items-center justify-center p-8 ${shellClass}`}
      >
        <div className="text-center">
          <p className="text-danger mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-sm text-muted hover:text-foreground underline"
          >
            {t('scoring.lice.retry')}
          </button>
        </div>
      </main>
    );
  }

  if (assignments.length === 0) {
    return (
      <main
        data-theme={chromeScope}
        className={`flex flex-col items-center justify-center p-8 ${shellClass}`}
      >
        <div className="text-center max-w-sm">
          <h1 className="text-xl font-bold mb-2">{t('scoring.lice.noAssignedTitle')}</h1>
          <p className="text-muted text-sm">{t('scoring.lice.noAssignedDescription')}</p>
        </div>
      </main>
    );
  }

  return (
    <main data-theme={chromeScope} className={`p-6 ${shellClass}`}>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('scoring.lice.yourLices')}</h1>
          <p className="text-muted text-sm mt-1">{t('scoring.lice.selectLice')}</p>
        </div>
        <div className="flex items-center gap-4">
          <ThemeSwitcher />
          <button
            onClick={() => void handleLogout()}
            disabled={loggingOut}
            className="text-sm text-muted hover:text-foreground underline disabled:opacity-50"
          >
            {t('scoring.lice.logout')}
          </button>
        </div>
      </header>

      <div className="grid gap-4 max-w-lg">
        {assignments.map((assignment) => (
          <button
            key={assignment.liceId}
            onClick={() => router.push(`/lices/${assignment.liceId}`)}
            className="bg-surface hover:bg-border border border-border rounded-xl p-5 text-left transition-colors"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">{assignment.liceName}</h2>
                <p className="text-muted text-sm">
                  {[assignment.tournamentName, assignment.eventName].filter(Boolean).join(' - ')}
                </p>
              </div>
              {assignment.currentMatchId ? (
                <span className="bg-danger text-danger-foreground text-xs font-bold px-2 py-1 rounded-full animate-pulse">
                  {t('scoring.lice.live')}
                </span>
              ) : (
                <span className="text-muted text-sm">-&gt;</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </main>
  );
}
