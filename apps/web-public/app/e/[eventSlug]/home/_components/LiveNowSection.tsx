'use client';

/**
 * LiveNowSection — the auto-refreshing "what's happening right now" block on the
 * public event home. Two independent live inputs under one roof:
 *
 *   • Matches — polled from the public `/live-state` endpoint (seeded by the SSR
 *     snapshot so there's no flash), refreshed by a 30s interval AND a Supabase
 *     realtime channel on `matches` filtered to the event's lices. Scores tick
 *     live without a reload. Data layer mirrors the standalone /live page.
 *   • Workshops — have no realtime state; they move purely by the clock, so
 *     "live" / "starting soon" is a pure derivation off the shared `useClientClock`
 *     minute store, which also honours an active super-admin time simulation. The
 *     server-passed `nowIso` seeds the first paint so SSR and hydration agree.
 *
 * Renders `null` when nothing is live or upcoming — so completed / pre-event
 * pages stay clean, exactly like the server markup it replaced.
 */

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatInZone, localeToBcp47 } from '@myclash/time';
import { useClientClock } from '@myclash/ui';
import { getPublicApiUrl } from '@/lib/api-url';
import { useRealtimeWithFallback } from '@/lib/supabase-browser';
import { useI18n } from '@/i18n/I18nProvider';
import type { HighlightMatch, PublicWorkshop } from '../_lib/public-event-data';
import { liveWorkshops, upcomingWorkshops } from '../_lib/live-workshops';
import { LiveMatchCard } from './LiveMatchCard';
import { WorkshopCard } from './WorkshopCard';

/** The raw `/live-state` envelope — carries lice ids the flattened highlights drop. */
interface LiveStateResponse {
  lices?: Array<{
    lice: { id: string; name: string };
    runningMatch: Omit<HighlightMatch, 'liceName'> | null;
    nextMatch: Omit<HighlightMatch, 'liceName'> | null;
  }>;
}

function flattenHighlights(data: LiveStateResponse): HighlightMatch[] {
  return (data.lices ?? []).flatMap((state) =>
    [state.runningMatch, state.nextMatch]
      .filter((m): m is Omit<HighlightMatch, 'liceName'> => m !== null)
      .map((m) => ({ ...m, liceName: state.lice.name })),
  );
}

interface Props {
  eventSlug: string;
  initialHighlights: HighlightMatch[];
  workshops: PublicWorkshop[];
  tz: string;
  /** Server render time (ISO) — seeds the workshop clock so SSR and hydration agree. */
  nowIso: string;
}

export function LiveNowSection({ eventSlug, initialHighlights, workshops, tz, nowIso }: Props) {
  const { t, locale } = useI18n();
  const tag = localeToBcp47(locale);
  const apiUrl = getPublicApiUrl();

  // ── Matches: seed from SSR, then poll + realtime (mirrors /live page). ────────
  const [highlights, setHighlights] = useState<HighlightMatch[]>(initialHighlights);
  const [liceIds, setLiceIds] = useState<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchState() {
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventSlug}/live-state`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = (await res.json()) as LiveStateResponse;
      setHighlights(flattenHighlights(data));
      setLiceIds((data.lices ?? []).map((l) => l.lice.id));
    } catch {
      // Keep the last known highlights.
    }
  }

  useEffect(() => {
    // Inlined mount fetch (not `fetchState()`): the setState lands inside a `.then`
    // callback, which the react-hooks/set-state-in-effect rule allows — a bare
    // synchronous `fetchState()` in the effect body would trip it. Mirrors /live.
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/events/${eventSlug}/live-state`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as LiveStateResponse;
        setHighlights(flattenHighlights(data));
        setLiceIds((data.lices ?? []).map((l) => l.lice.id));
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

  useRealtimeWithFallback({
    channelName: `home-live-${eventSlug}`,
    table: 'matches',
    filter: `lice_id=in.(${liceIds.join(',')})`,
    event: 'UPDATE',
    enabled: liceIds.length > 0,
    onEvent: () => void fetchState(),
    onFallbackPoll: () => void fetchState(),
  });

  const liveMatches = highlights.filter((m) => m.status === 'running');
  const upcomingMatches = highlights.filter((m) => m.status === 'scheduled').slice(0, 5);

  // ── Workshops: derive live / upcoming off the shared clock. ───────────────────
  const { nowMs: clock } = useClientClock(apiUrl);
  const nowMs = clock === 0 ? Date.parse(nowIso) : clock;
  const liveWs = useMemo(() => liveWorkshops(workshops, nowMs), [workshops, nowMs]);
  const upcomingWs = useMemo(() => upcomingWorkshops(workshops, nowMs), [workshops, nowMs]);

  const hasLive = liveMatches.length > 0 || liveWs.length > 0;
  const hasUpcoming = upcomingMatches.length > 0 || upcomingWs.length > 0;
  if (!hasLive && !hasUpcoming) return null;

  return (
    <>
      {hasLive && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-success">
            <span className="inline-block h-2 w-2 rounded-full bg-success motion-safe:animate-pulse" />
            {t('publicApp.eventHome.liveNow')}
          </h2>
          <div className="flex flex-col gap-3">
            {liveMatches.map((m) => (
              <LiveMatchCard key={m.id} match={m} href={`/e/${eventSlug}/match/${m.id}`} />
            ))}
          </div>
          {liveWs.length > 0 && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {liveWs.map((w) => (
                <WorkshopCard
                  key={w.id}
                  workshop={w}
                  eventSlug={eventSlug}
                  tz={tz}
                  locale={locale}
                />
              ))}
            </div>
          )}
          {liveMatches.length > 0 && (
            <Link
              href={`/e/${eventSlug}/live`}
              className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:text-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {t('publicApp.eventHome.viewLiveBoard')} →
            </Link>
          )}
        </section>
      )}

      {hasUpcoming && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            {t('publicApp.eventHome.scheduleHighlights')}
          </h2>
          <div className="flex flex-col gap-2">
            {upcomingMatches.map((m) => (
              <Link
                key={m.id}
                href={`/e/${eventSlug}/match/${m.id}`}
                className="block rounded-xl border border-border bg-surface px-4 py-3 shadow-sm transition-colors hover:border-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {t('publicApp.eventHome.matchVersus', {
                        a: m.redFighterName ?? '?',
                        b: m.blueFighterName ?? '?',
                      })}
                    </p>
                    <p className="text-xs text-muted">
                      {[m.tournamentName, m.matchNumberLabel].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {m.scheduledAt && (
                    <span className="rounded-md bg-border px-2 py-1 font-mono text-xs text-foreground-secondary">
                      {formatInZone(
                        m.scheduledAt,
                        tz,
                        { hour: '2-digit', minute: '2-digit', hour12: false },
                        tag,
                      )}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
          {upcomingWs.length > 0 && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {upcomingWs.map((w) => (
                <WorkshopCard
                  key={w.id}
                  workshop={w}
                  eventSlug={eventSlug}
                  tz={tz}
                  locale={locale}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
