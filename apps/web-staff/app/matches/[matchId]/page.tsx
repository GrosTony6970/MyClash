'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BoutNotLoadedView,
  MatchView,
  NoMatchView,
  type MatchInfo,
} from '../../../src/components/MatchView';
import { QuarantineInbox } from '../../../src/components/QuarantineInbox';
import { RememberedUndos } from '../../../src/components/RememberedUndos';
import { SyncBar } from '../../../src/components/SyncBar';
import { useSignInWhenSessionEnded } from '../../../src/hooks/useSignInWhenSessionEnded';
import { useSendEnded, useSyncState } from '../../../src/offline/use-sync-state';
import { useI18n } from '@myclash/next-i18n/client';
import { getApiUrl } from '../../../src/lib/api-url';
import { readBout } from '../../../src/lib/bout-read';
import { forgetBout, keepBout, keptBout } from '../../../src/offline/kept-bout';
import { getSyncEngine } from '../../../src/offline/sync';
import { safeReturnHref, staffRoutePrefix } from '../../../src/lib/nav';

interface Props {
  params: Promise<{ matchId: string }>;
}

/** How often a bout opened with no network is asked for again. */
const BOUT_NOT_LOADED_RETRY_MS = 5_000;

/**
 * Per-match scoring route. Lets the admin bracket deep-link straight
 * into the scoring UI for one match — no lice context required.
 *
 * The bout is read by `readBout` (`src/lib/bout-read.ts`). Each good read is
 * kept on the tablet, and a read that finds no network opens that copy
 * (`src/offline/kept-bout.ts`).
 */
export default function MatchScoringPage({ params }: Props) {
  const { t } = useI18n();
  const apiUrl = getApiUrl();
  // Durable offline sync: exchanges are written to an IndexedDB outbox and POSTed by
  // this engine (immediately when online, on reconnect when offline). Singleton per tab.
  const syncEngine = useMemo(() => getSyncEngine(apiUrl), [apiUrl]);
  const syncState = useSyncState(syncEngine);

  const [matchId, setMatchId] = useState<string | null>(null);
  // The bout on screen and where it came from, as ONE state: `readAt` is the
  // time of the tablet's copy, and null for the server's own answer. Two states
  // could say "from the tablet" over a bout the server just gave.
  const [shown, setShown] = useState<{ match: MatchInfo; readAt: number | null } | null>(null);
  const match = shown?.match ?? null;
  const fromTablet = shown !== null && shown.readAt !== null;
  const [loading, setLoading] = useState(true);
  // The last read of the bout met no network.
  const [unreachable, setUnreachable] = useState(false);
  const [quarantineOpen, setQuarantineOpen] = useState(false);
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
    setRoutePrefix(staffRoutePrefix(window.location.pathname));
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

  // No press waits for the send (ruling 316): the bout is read again when a
  // send has ended. Above the effect that starts the first send.
  const readBoutAgain = useCallback(() => setRefreshKey((key) => key + 1), []);
  useSendEnded(syncEngine, readBoutAgain);
  useSignInWhenSessionEnded();

  useEffect(() => {
    const handleOnline = () => {
      setNetworkStatus('online');
      // What was queued with no network. Not `sendBehind`: a send that left
      // before the network came back would take this one down with it.
      syncEngine.sendAfterReconnect();
      // Whatever the queue holds: an empty one ends no send, so nothing else
      // read a bout opened with no network. The race is this read against the
      // read at the end of that send, and `boutReads` below settles it: the
      // newest answer wins. A hit tapped while it is on its way is in the
      // tablet's queue, and the score counts it as it does after every send.
      readBoutAgain();
    };
    const handleOffline = () => setNetworkStatus('offline');
    window.addEventListener('online', handleOnline);
    // A tablet opened again while online gets no `online` event: send what it
    // holds now, or the bar is green over hits that wait.
    syncEngine.sendBehind();
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncEngine, readBoutAgain]);

  // The screen says the bout opens when the network is back, and the `online`
  // event alone does not keep that word: a tablet that kept its access point
  // while the uplink dropped gets none. So a bout not loaded is asked for
  // again until it is. A bout opened from the tablet's copy is not loaded
  // either: the server has not said it.
  const awaitsServer = unreachable && (shown === null || fromTablet);
  useEffect(() => {
    if (!awaitsServer) return;
    const timer = window.setInterval(readBoutAgain, BOUT_NOT_LOADED_RETRY_MS);
    return () => window.clearInterval(timer);
  }, [awaitsServer, readBoutAgain]);

  // The server's bout has just replaced the tablet's copy: the network is
  // back, with or without an `online` event. Send what the tablet holds; the
  // retry above asks for the bout only.
  const shownFromTablet = useRef(false);
  useEffect(() => {
    if (shownFromTablet.current && !fromTablet) syncEngine.sendBehind();
    shownFromTablet.current = fromTablet;
  }, [fromTablet, syncEngine]);

  // The race: two sends end close together (two hits in a row) and each reads
  // the bout. An answer that lands after a LATER read's answer must not win.
  // Counted, not cancelled: until a later answer lands, an earlier one is the
  // best the screen has (the later read may find no network).
  const boutReads = useRef({ asked: 0, shown: 0 });

  useEffect(() => {
    if (!matchId) return;
    const read = (boutReads.current.asked += 1);
    const isNewestAnswer = () => {
      if (read < boutReads.current.shown) return false;
      boutReads.current.shown = read;
      return true;
    };
    void (async () => {
      const answer = await readBout(apiUrl, matchId);
      // UNREACHABLE is marked, not only skipped, and it does not ask
      // `isNewestAnswer`: that would drop an earlier good answer still on its
      // way. With no bout on screen the tablet's copy opens, if it holds one.
      // The race: the copy is read from the tablet's store, which answers
      // late, and the server's answer to a LATER read may land first. So the
      // copy is set only while the screen holds no bout, and never after a
      // later read's answer was shown: that answer may be "this bout is gone".
      if (answer.kind === 'unreachable') {
        setUnreachable(true);
        const kept = await keptBout(matchId).catch(() => null);
        if (kept && read >= boutReads.current.shown) setShown((now) => now ?? kept);
        setLoading(false);
        return;
      }
      // The server answered: whatever the order of the answers, it is in reach.
      setUnreachable(false);
      setLoading(false);
      if (!isNewestAnswer()) return;
      if (answer.kind !== 'bout') {
        setShown(null);
        // Only a bout the server says is GONE loses its copy. A server fault
        // says nothing about the bout: the hall's wifi may drop next.
        if (answer.kind === 'gone') void forgetBout(matchId).catch(() => undefined);
        return;
      }
      setShown({ match: answer.match, readAt: null });
      // Kept for the next read that finds no network. A store that refuses the
      // write costs that convenience only. A bout read without its names (the
      // summary did not land) does not replace a copy that has them.
      if (answer.labelled) void keepBout(answer.match).catch(() => undefined);
    })();
  }, [matchId, apiUrl, refreshKey]);

  if (loading) {
    return (
      <main id="main-content" className="flex min-h-screen items-center justify-center">
        <p className="text-muted">{t('scoring.lice.loadingMatch')}</p>
      </main>
    );
  }

  return (
    <main id="main-content" className="min-h-screen flex flex-col">
      <SyncBar
        networkStatus={networkStatus}
        syncState={syncState}
        syncEngine={syncEngine}
        onReview={() => setQuarantineOpen(true)}
      />
      {/* An undo the tablet wrote down is settled with the server (rulings 350, 354). */}
      {matchId && (
        <RememberedUndos
          key={matchId}
          engine={syncEngine}
          apiUrl={apiUrl}
          matchId={matchId}
          onSettled={readBoutAgain}
        />
      )}

      {match ? (
        <MatchView
          // A new screen when the server's bout replaces the copy: the copy's
          // screen could read no clock, no list and no neighbour, and keeps
          // none. Mounted again, it reads them all, as a first open does.
          key={fromTablet ? 'copy' : 'server'}
          match={match}
          apiUrl={apiUrl}
          networkStatus={networkStatus}
          syncEngine={syncEngine}
          onRefresh={readBoutAgain}
          externalDisplayUrl={externalDisplayUrl}
          backHref={backHref}
          buildMatchHref={buildMatchHref}
          readFromTabletAt={shown?.readAt ?? null}
        />
      ) : unreachable ? (
        <BoutNotLoadedView onRetry={readBoutAgain} />
      ) : (
        <NoMatchView mode="match" />
      )}

      <QuarantineInbox
        open={quarantineOpen}
        onClose={() => setQuarantineOpen(false)}
        syncEngine={syncEngine}
      />
    </main>
  );
}
