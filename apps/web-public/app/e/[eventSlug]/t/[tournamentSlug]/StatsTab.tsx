'use client';

/**
 * StatsTab — the inline "Statistics" tab panel, load-on-demand.
 *
 * The tournament page mounts every tab panel at once (inactive ones are
 * `hidden`), so a naïve fetch-on-mount would pull the (heavy) stats
 * projections for every visitor even when nobody opens the tab. Instead we
 * fetch **once**, the first time the panel becomes visible — i.e. when the
 * user actually opens the tab.
 *
 * Visibility is detected with an IntersectionObserver rather than the URL
 * hash: `TournamentTabs.switchTo` updates the hash with `history.replaceState`,
 * which does NOT emit `hashchange`, so a hash listener would miss tab clicks.
 * Un-hiding the wrapping `<section hidden>` (display:none→visible) reliably
 * fires the observer.
 *
 * The rendering itself lives in the shared, hook-free `StatsView` (also used by
 * the standalone `/stats` route).
 */

import { useEffect, useRef, useState } from 'react';
import { getPublicApiUrl } from '@/lib/api-url';
import { useI18n } from '@myclash/next-i18n/client';
import { fetchTournamentStats, type TournamentStats } from './stats-data';
import { StatsView } from './StatsView';

interface Props {
  tournamentId: string;
  /** The tournament's colour token — section headings take its legible tint. */
  colorToken?: string | null;
}

export function StatsTab({ tournamentId, colorToken }: Props) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const startedRef = useRef(false);
  const [data, setData] = useState<TournamentStats | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    // Fire once, when the panel first becomes visible. The observer callback
    // runs asynchronously (never synchronously in this effect body), so the
    // setState calls below don't trip `react-hooks/set-state-in-effect`.
    const io = new IntersectionObserver(
      (entries) => {
        if (startedRef.current || !entries.some((e) => e.isIntersecting)) return;
        startedRef.current = true;
        io.disconnect();
        setStatus('loading');
        // getPublicApiUrl(): browser-reachable base — getServerApiUrl is
        // lint-blocked in 'use client' files (no-server-api-url-leak).
        fetchTournamentStats(tournamentId, getPublicApiUrl())
          .then((d) => {
            setData(d);
            setStatus('idle');
          })
          .catch(() => setStatus('error'));
      },
      // Generous margin so a tab opened while scrolled still counts as visible.
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [tournamentId]);

  return (
    <div ref={rootRef}>
      {status === 'loading' && (
        <p className="text-sm italic text-muted">{t('publicApp.tournament.loading')}</p>
      )}
      {status === 'error' && (
        <p className="rounded-xl border border-dashed border-border bg-background p-6 text-center text-sm text-muted">
          {t('publicApp.tournamentStats.unavailable')}
        </p>
      )}
      {data && (
        <StatsView
          overview={data.overview}
          fighters={data.fighters}
          afterblow={data.afterblow}
          targets={data.targets}
          colorToken={colorToken}
          t={t}
        />
      )}
    </div>
  );
}
