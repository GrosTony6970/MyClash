'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MatchView, NoMatchView, type MatchInfo } from '../../../src/components/MatchView';
import { useI18n } from '../../../src/i18n/I18nProvider';

interface Props {
  params: Promise<{ matchId: string }>;
}

/**
 * Per-match scoring route. Lets the admin bracket deep-link straight
 * into the scoring UI for one match — no lice context required.
 *
 * Combines `GET /matches/:id` (raw row with registrations + scores +
 * locked_at) and `GET /matches/:id/summary` (roundCode + fighter
 * names + weapon + tournamentId + phaseType).
 */
export default function MatchScoringPage({ params }: Props) {
  const router = useRouter();
  const { t } = useI18n();
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [matchId, setMatchId] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [networkStatus, setNetworkStatus] = useState<'online' | 'offline'>(
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'online',
  );
  // `?return=<url>` survives hard refresh / bookmark — the
  // history-based back button doesn't. Read it on mount so the
  // operator always has a way back to the admin page they came
  // from.
  const [returnUrl, setReturnUrl] = useState<string | null>(null);

  useEffect(() => {
    void params.then(({ matchId: id }) => setMatchId(id));
  }, [params]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    setReturnUrl(url.searchParams.get('return'));
  }, []);

  useEffect(() => {
    const handleOnline = () => setNetworkStatus('online');
    const handleOffline = () => setNetworkStatus('offline');
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!matchId) return;
    void (async () => {
      try {
        const [rawRes, summaryRes] = await Promise.all([
          fetch(`${apiUrl}/api/v1/matches/${matchId}`, { credentials: 'include' }),
          fetch(`${apiUrl}/api/v1/matches/${matchId}/summary`, { credentials: 'include' }),
        ]);
        // Hard requirement: the raw row must exist. If it doesn't,
        // the match is gone (deleted / wrong id) — fall through to
        // the unavailable state below.
        if (!rawRes.ok) {
          setMatch(null);
          return;
        }
        const raw = (await rawRes.json()) as {
          id: string;
          match_number_label: string | null;
          status: string;
          ruleset_code: string;
          ruleset_version: string;
          red_registration_id: string;
          blue_registration_id: string;
          red_score: number | null;
          blue_score: number | null;
          locked_at: string | null;
        };
        // Soft requirement: summary is labels only (roundCode,
        // fighter names, weapon, tournamentId). The most common 404
        // here is a placeholder bracket slot with TBD fighters that
        // vw_tournament_query_matches refuses to project. Render the
        // scoreboard with blank labels rather than blocking the whole
        // page on a name lookup — the operator just wants the pad.
        const summary = summaryRes.ok
          ? ((await summaryRes.json()) as {
              roundCode: string;
              redName: string;
              blueName: string;
              weapon: string;
              tournamentId: string;
              phaseType: 'pool' | 'single_elim' | 'double_elim' | 'swiss' | null;
            })
          : null;
        setMatch({
          id: raw.id,
          matchNumberLabel: raw.match_number_label ?? '',
          roundCode: summary?.roundCode ?? '',
          status: raw.status,
          rulesetCode: raw.ruleset_code,
          rulesetVersion: raw.ruleset_version,
          redRegistrationId: raw.red_registration_id,
          blueRegistrationId: raw.blue_registration_id,
          redScore: raw.red_score ?? 0,
          blueScore: raw.blue_score ?? 0,
          redFighterName: summary?.redName ?? '',
          blueFighterName: summary?.blueName ?? '',
          weapon: summary?.weapon ?? '',
          tournamentId: summary?.tournamentId,
          phaseType: summary?.phaseType ?? null,
          lockedAt: raw.locked_at,
        });
      } catch {
        // Offline — leave the cached match in place
      } finally {
        setLoading(false);
      }
    })();
  }, [matchId, apiUrl, refreshKey]);

  if (loading) {
    return (
      <main id="main-content" className="flex min-h-screen items-center justify-center">
        <p className="text-gray-400">{t('scoring.lice.loadingMatch')}</p>
      </main>
    );
  }

  return (
    <main id="main-content" className="min-h-screen flex flex-col">
      <div
        className={`px-4 py-1 text-xs font-bold text-center ${
          networkStatus === 'online'
            ? 'bg-green-900 text-green-300'
            : 'bg-red-900 text-red-300 animate-pulse'
        }`}
      >
        {networkStatus === 'online'
          ? `● ${t('scoring.lice.online')}`
          : `● ${t('scoring.lice.offlineQueued')}`}
      </div>

      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <button
          onClick={() => {
            if (returnUrl) window.location.href = returnUrl;
            else router.back();
          }}
          className="text-gray-400 hover:text-white text-sm"
        >
          ← {t('scoring.lice.backToLices')}
        </button>
        <h1 className="font-bold text-lg">{match?.roundCode || match?.matchNumberLabel || ''}</h1>
        <div className="w-16" />
      </header>

      {match ? (
        <MatchView
          match={match}
          apiUrl={apiUrl}
          networkStatus={networkStatus}
          onRefresh={() => setRefreshKey((key) => key + 1)}
        />
      ) : (
        <NoMatchView mode="match" />
      )}
    </main>
  );
}
