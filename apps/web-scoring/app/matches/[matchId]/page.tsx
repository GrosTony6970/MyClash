'use client';

import { useEffect, useState } from 'react';
import { MatchView, NoMatchView, type MatchInfo } from '../../../src/components/MatchView';
import { useI18n } from '../../../src/i18n/I18nProvider';
import { getApiUrl } from '../../../src/lib/api-url';

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
  const { t } = useI18n();
  const apiUrl = getApiUrl();

  const [matchId, setMatchId] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [networkStatus, setNetworkStatus] = useState<'online' | 'offline'>(
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'online',
  );
  // `?externalDisplay=<url>` is the optional projection-screen link
  // the admin sets when proxying this view via /scoring/*. The
  // `?return=<url>` legacy param is no longer used — the new header
  // builds a deterministic back-link from match.liceId.
  const [externalDisplayUrl, setExternalDisplayUrl] = useState<string | null>(null);

  useEffect(() => {
    void params.then(({ matchId: id }) => setMatchId(id));
  }, [params]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    setExternalDisplayUrl(url.searchParams.get('externalDisplay'));
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
          lice_id: string | null;
        };
        // Soft requirement: summary is labels only (roundCode,
        // fighter names, clubs, weapon, tournamentId). The most
        // common 404 here is a placeholder bracket slot with TBD
        // fighters that vw_tournament_query_matches refuses to
        // project. Render the scoreboard with blank labels rather
        // than blocking the whole page on a name lookup.
        const summary = summaryRes.ok
          ? ((await summaryRes.json()) as {
              roundCode: string;
              redName: string;
              blueName: string;
              redClub?: string | null;
              blueClub?: string | null;
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
          redClub: summary?.redClub ?? null,
          blueClub: summary?.blueClub ?? null,
          weapon: summary?.weapon ?? '',
          tournamentId: summary?.tournamentId,
          phaseType: summary?.phaseType ?? null,
          lockedAt: raw.locked_at,
          liceId: raw.lice_id,
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

      {match ? (
        <MatchView
          match={match}
          apiUrl={apiUrl}
          networkStatus={networkStatus}
          onRefresh={() => setRefreshKey((key) => key + 1)}
          externalDisplayUrl={externalDisplayUrl}
        />
      ) : (
        <NoMatchView mode="match" />
      )}
    </main>
  );
}
