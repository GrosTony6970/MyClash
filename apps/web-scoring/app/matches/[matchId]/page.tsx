'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MatchView, NoMatchView, type MatchInfo } from '../../../src/components/MatchView';
import { useSyncState } from '../../../src/components/SyncStatus';
import { useI18n } from '../../../src/i18n/I18nProvider';
import { getApiUrl } from '../../../src/lib/api-url';
import { getSyncEngine } from '../../../src/offline/sync';
import { safeReturnHref, scoringRoutePrefix } from '../../../src/lib/nav';

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
  // Durable offline sync: exchanges are written to an IndexedDB outbox and POSTed by
  // this engine (immediately when online, on reconnect when offline). Singleton per tab.
  const syncEngine = useMemo(() => getSyncEngine(apiUrl), [apiUrl]);
  const syncState = useSyncState(syncEngine);

  const [matchId, setMatchId] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [networkStatus, setNetworkStatus] = useState<'online' | 'offline'>(
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'online',
  );
  // `?externalDisplay=<url>` is the optional projection-screen link the
  // admin sets when proxying this view via /scoring/*. `?return=<url>`
  // is the admin page the operator came from — its back-link target
  // (resolves on admin.${DOMAIN}, sidestepping the /scoring prefix that
  // a root-relative /lices/{id} link would lose). `routePrefix` is
  // `/scoring` under the admin proxy, '' on the canonical scoring
  // subdomain — prefixes in-app match navigation so prev/next tiles
  // don't escape the mount.
  const [externalDisplayUrl, setExternalDisplayUrl] = useState<string | null>(null);
  const [backHref, setBackHref] = useState<string | null>(null);
  const [routePrefix, setRoutePrefix] = useState('');
  const [returnParam, setReturnParam] = useState<string | null>(null);

  useEffect(() => {
    void params.then(({ matchId: id }) => setMatchId(id));
  }, [params]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const ext = url.searchParams.get('externalDisplay');
    const ret = url.searchParams.get('return');
    /* eslint-disable react-hooks/set-state-in-effect -- one-time sync of UI state from window.location on mount (SSR-safe). */
    setExternalDisplayUrl(ext);
    setReturnParam(ret);
    setBackHref(safeReturnHref(ret, window.location.origin));
    setRoutePrefix(scoringRoutePrefix(window.location.pathname));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Build in-scoring match hrefs (prev/next tiles) that carry the
  // /scoring prefix + forward return/externalDisplay so the back-link
  // and projection link keep working after a tile jump.
  const buildMatchHref = useCallback(
    (id: string) => {
      const qs = new URLSearchParams();
      if (returnParam) qs.set('return', returnParam);
      if (externalDisplayUrl) qs.set('externalDisplay', externalDisplayUrl);
      const s = qs.toString();
      return `${routePrefix}/matches/${id}${s ? `?${s}` : ''}`;
    },
    [routePrefix, returnParam, externalDisplayUrl],
  );

  useEffect(() => {
    const handleOnline = () => {
      setNetworkStatus('online');
      void syncEngine.drain(); // flush any exchanges queued while offline
    };
    const handleOffline = () => setNetworkStatus('offline');
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncEngine]);

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
          end_reason: string | null;
          // Best-of-N round state (matches columns; default to a single round).
          current_round: number | null;
          red_round_wins: number | null;
          blue_round_wins: number | null;
          rounds_json: unknown;
          awaiting_round_advance: boolean | null;
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
              tournamentName?: string | null;
              poolName?: string | null;
              liceName?: string | null;
              phaseType: 'pool' | 'single_elim' | 'double_elim' | 'swiss' | null;
              /** Effective best-of for this match's phase (not a matches column). */
              bestOf?: number;
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
          tournamentName: summary?.tournamentName ?? null,
          poolName: summary?.poolName ?? null,
          liceName: summary?.liceName ?? null,
          phaseType: summary?.phaseType ?? null,
          lockedAt: raw.locked_at,
          liceId: raw.lice_id,
          endReason: raw.end_reason ?? null,
          // bestOf is the effective number from the summary; the live round
          // counters come off the raw matches row (re-fetched on refreshKey).
          bestOf: summary?.bestOf ?? 1,
          currentRound: raw.current_round ?? 1,
          redRoundWins: raw.red_round_wins ?? 0,
          blueRoundWins: raw.blue_round_wins ?? 0,
          roundsJson: raw.rounds_json ?? null,
          awaitingRoundAdvance: raw.awaiting_round_advance ?? false,
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
        data-testid="network-bar"
        data-network={networkStatus}
        data-pending={syncState?.pendingCount ?? 0}
        className={`px-4 py-1 text-xs font-bold text-center ${
          networkStatus === 'online'
            ? 'bg-green-900 text-green-300'
            : 'bg-red-900 text-red-300 animate-pulse'
        }`}
      >
        {networkStatus === 'online'
          ? `● ${t('scoring.lice.online')}`
          : `● ${t('scoring.lice.offlineQueued')}`}
        {(syncState?.pendingCount ?? 0) > 0 && ` (${syncState?.pendingCount})`}
      </div>

      {match ? (
        <MatchView
          match={match}
          apiUrl={apiUrl}
          networkStatus={networkStatus}
          syncEngine={syncEngine}
          onRefresh={() => setRefreshKey((key) => key + 1)}
          externalDisplayUrl={externalDisplayUrl}
          backHref={backHref}
          buildMatchHref={buildMatchHref}
        />
      ) : (
        <NoMatchView mode="match" />
      )}
    </main>
  );
}
