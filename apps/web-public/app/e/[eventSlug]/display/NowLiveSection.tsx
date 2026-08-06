'use client';

/**
 * NowLiveSection — the top of the display hub.
 *
 * The operator's first question is not "where do I sign in", it is "what is
 * being fought right now, and on which screen do I put it". This block answers
 * both: one card per piste with a bout in progress, carrying the hall it stands
 * in and a link straight to that piste's kiosk.
 *
 * Liveness comes from `live-state.runningMatch` and nothing else. It is never
 * inferred from "the payload has a match" — that inference is what put merely
 * SCHEDULED bouts under a LIVE banner on three separate surfaces.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { isLiveStatus, placementLabel, type HubLice } from '@myclash/types';
import { getPublicApiUrl } from '@/lib/api-url';
import { useRealtimeWithFallback } from '@/lib/supabase-browser';
import { useI18n } from '../../../../src/i18n/I18nProvider';

interface LiveMatch {
  id: string;
  matchNumberLabel: string;
  redFighterName: string | null;
  blueFighterName: string | null;
  status: string;
  tournamentName: string | null;
  redScore: number;
  blueScore: number;
}

interface LiveLiceState {
  lice: { id: string; name: string; sortOrder: number };
  runningMatch: LiveMatch | null;
  nextMatch: LiveMatch | null;
}

interface LiveStateResponse {
  lices: LiveLiceState[];
}

interface Props {
  eventSlug: string;
  /** The SSR lice list — the only place the venue/area labels come from. */
  lices: HubLice[];
}

export function NowLiveSection({ eventSlug, lices }: Props) {
  const { t } = useI18n();
  const apiUrl = getPublicApiUrl();
  const [state, setState] = useState<LiveStateResponse | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchState() {
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventSlug}/live-state`, {
        cache: 'no-store',
      });
      if (res.ok) setState((await res.json()) as LiveStateResponse);
    } catch {
      // Keep the last known state — a wall screen that blanks on one failed
      // poll is worse than one showing a bout thirty seconds stale.
    }
  }

  useEffect(() => {
    // Inlined mount fetch (not `fetchState()`): the setState lands inside a
    // `.then` callback, which the react-hooks/set-state-in-effect rule allows.
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/events/${eventSlug}/live-state`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.ok) setState((await res.json()) as LiveStateResponse);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
      });
    timerRef.current = setInterval(() => void fetchState(), 30_000);
    return () => {
      controller.abort();
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventSlug]);

  const liceIds = (state?.lices ?? []).map((l) => l.lice.id);
  useRealtimeWithFallback({
    channelName: `display-hub-${eventSlug}`,
    table: 'matches',
    filter: `lice_id=in.(${liceIds.join(',')})`,
    event: 'UPDATE',
    enabled: liceIds.length > 0,
    // Explicit rather than defaulted: this hub sits unattended on a venue
    // screen, and a `matches` binding that ever falls out of the realtime
    // publication kills the channel permanently with no rejoin. The poll is
    // the only thing that keeps the board honest when that happens.
    fallbackPollMs: 30_000,
    onEvent: () => void fetchState(),
    onFallbackPoll: () => void fetchState(),
  });

  const placements = new Map(lices.map((lice) => [lice.id, lice]));
  const live = (state?.lices ?? [])
    .flatMap((entry) => {
      const match = entry.runningMatch;
      // `isLiveStatus` is belt-and-braces: live-state already promises this
      // slot only ever holds a running or paused bout, but a reader that
      // trusts a field name over a status is exactly how scheduled bouts
      // ended up under a LIVE banner elsewhere.
      return match && isLiveStatus(match.status) ? [{ lice: entry.lice, match }] : [];
    })
    .sort((a, b) => a.lice.sortOrder - b.lice.sortOrder || a.lice.name.localeCompare(b.lice.name));

  return (
    <section className="mt-6">
      <h2 className="font-display text-lg font-semibold">{t('publicApp.display.nowLive')}</h2>
      {live.length === 0 ? (
        // Deliberately a message, not a hidden section: an operator has to be
        // able to tell "nothing running" from "this widget is broken".
        <p data-testid="now-live-empty" className="mt-2 text-sm text-muted">
          {t('publicApp.display.nowLiveEmpty')}
        </p>
      ) : (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {live.map((entry) => (
            <LiveCard
              key={entry.lice.id}
              eventSlug={eventSlug}
              liceName={entry.lice.name}
              placement={placements.get(entry.lice.id) ?? null}
              match={entry.match}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function LiveCard({
  eventSlug,
  liceName,
  placement,
  match,
}: {
  eventSlug: string;
  liceName: string;
  placement: HubLice | null;
  match: LiveMatch;
}) {
  const { t } = useI18n();
  const paused = match.status === 'paused';
  const where = placementLabel(placement?.venue?.name ?? null, placement?.area?.name ?? null);

  return (
    <li>
      <Link
        href={`/e/${eventSlug}/lice/${encodeURIComponent(liceName)}/display`}
        className="flex h-full flex-col rounded-lg border border-danger/40 bg-danger/10 p-4 transition hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-display text-lg font-bold">{liceName}</span>
          {paused ? (
            <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-bold text-muted">
              {t('publicApp.live.paused')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-danger px-2 py-0.5 text-xs font-bold text-danger-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-danger-foreground" />
              {t('publicApp.live.badge')}
            </span>
          )}
        </div>
        {where && <span className="mt-0.5 text-sm text-muted">{where}</span>}
        <p className="mt-2 text-sm font-bold text-foreground">{match.matchNumberLabel}</p>
        <p className="mt-0.5 text-sm text-foreground-secondary">
          {match.redFighterName ?? '?'}{' '}
          <span className="text-xs text-muted">{t('scoring.liveMatch.versus')}</span>{' '}
          {match.blueFighterName ?? '?'}
        </p>
        <p className="mt-1 text-sm font-bold text-foreground">
          {match.redScore} – {match.blueScore}
        </p>
        {match.tournamentName && <p className="mt-1 text-xs text-muted">{match.tournamentName}</p>}
        <span className="mt-2 text-sm font-semibold text-accent">
          {t('publicApp.display.openDisplay')} →
        </span>
      </Link>
    </li>
  );
}
