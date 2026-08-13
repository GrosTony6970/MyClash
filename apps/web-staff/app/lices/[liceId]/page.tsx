'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@myclash/next-i18n/client';
import { useScoringTheme } from '../../../src/theme/ThemeProvider';
import { getApiUrl } from '../../../src/lib/api-url';
import { useLiceMatches } from '../../../src/hooks/useLiceMatches';
import { partitionLiceMatches } from '../../../src/components/partition-lice-matches';
import type { LiceMatch } from '../../../src/components/lice-match-types';
import { AllMatchesDisclosure } from './_components/AllMatchesDisclosure';
import { GroupedMatchList } from './_components/GroupedMatchList';
import { LiceHeader, NetworkBar } from './_components/LiceHeader';
import { TournamentSections } from './_components/TournamentSections';

interface Props {
  params: Promise<{ liceId: string }>;
}

function MatchSection({
  heading,
  matches,
  emptyLabel,
  testId,
}: {
  heading: string;
  matches: LiceMatch[];
  emptyLabel?: string;
  testId?: string;
}) {
  return (
    <section data-testid={testId} className="mb-6">
      <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted">{heading}</h2>
      {matches.length === 0 && emptyLabel ? (
        <p className="rounded-lg border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-muted">
          {emptyLabel}
        </p>
      ) : (
        <GroupedMatchList matches={matches} />
      )}
    </section>
  );
}

/** Tracks the browser's own connectivity, which drives the status strip. */
function useNetworkStatus(): 'online' | 'offline' {
  const [status, setStatus] = useState<'online' | 'offline'>(
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'online',
  );
  useEffect(() => {
    const goOnline = () => setStatus('online');
    const goOffline = () => setStatus('offline');
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  return status;
}

/**
 * Per-lice match list — the screen a piste operator lives on between bouts.
 *
 * Shows what is genuinely running, the next few bouts, and (behind a tap) the
 * piste's whole day including what has already been played, with scores and the
 * referee officiating each one.
 *
 * Routes:
 *   - `/lices` → lice picker
 *   - `/lices/[liceId]` → THIS page
 *   - `/matches/[matchId]` → scoreboard (linked from here)
 */
export default function LiceMatchListPage({ params }: Props) {
  const router = useRouter();
  const { t } = useI18n();
  const { chromeScope } = useScoringTheme();
  const networkStatus = useNetworkStatus();
  const [liceId, setLiceId] = useState<string | null>(null);

  useEffect(() => {
    void params.then(({ liceId: id }) => setLiceId(id));
  }, [params]);

  const apiUrl = getApiUrl();
  const { data, loading, sessionExpired } = useLiceMatches(apiUrl, liceId);

  useEffect(() => {
    if (sessionExpired) router.replace('/login');
  }, [sessionExpired, router]);

  // Defensive: a 200 carrying an unexpected body must render an empty piste,
  // not throw. The previous version read `data.queue.length` straight off the
  // payload and white-screened on anything that wasn't the exact shape.
  const { live, next, all } = partitionLiceMatches(data?.matches ?? []);

  if (loading) {
    return (
      // Same scope as the loaded state below, or the screen changes surface
      // the moment the fetch lands.
      <main
        id="main-content"
        data-theme={chromeScope}
        className="flex min-h-screen items-center justify-center bg-background text-foreground"
      >
        <p className="text-muted">{t('scoring.lice.loadingMatch')}</p>
      </main>
    );
  }

  return (
    // Own data-theme — this is the app's chrome (see MatchHeader: "hybrid:
    // light chrome, dark scoring area"). Tokens inherit from <body>, so a
    // region that differs from the pad needs its own scope to override with.
    <main
      id="main-content"
      data-theme={chromeScope}
      className="min-h-screen flex flex-col bg-background text-foreground"
    >
      {/* Sticky, not fixed: the operator scrolls a 60-bout day and still has to
          know which piste this is, but fixed chrome leaves the flow and paints
          over whatever the root layout puts above it. */}
      {/* `bg-background` on the wrapper is load-bearing: NetworkBar's tint is
          `bg-success/15`, so without an opaque backdrop the match list would
          scroll visibly through it. */}
      <div className="sticky top-0 z-sticky bg-background">
        <NetworkBar status={networkStatus} />
        <LiceHeader liceName={data?.liceName ?? null} />
      </div>

      {/* max-w-5xl, not 3xl: the pool grid is the admin Matches table (seven
          columns, clubs included) and at 3xl it pushed Lice and Status off the
          side on the 1024px tablets the pistes actually run. */}
      <div className="flex-1 p-4 max-w-5xl w-full mx-auto">
        {/* Only rendered when something is genuinely running or paused. */}
        {live.length > 0 && (
          <MatchSection heading={t('scoring.lice.live')} matches={live} testId="live-section" />
        )}
        <MatchSection
          heading={t('scoring.lice.nextMatchLabel')}
          matches={next}
          emptyLabel={t('scoring.lice.noNextMatch')}
        />
        <AllMatchesDisclosure matches={all} />
        <TournamentSections matches={all} apiUrl={apiUrl} liceId={liceId ?? ''} />
      </div>
    </main>
  );
}
