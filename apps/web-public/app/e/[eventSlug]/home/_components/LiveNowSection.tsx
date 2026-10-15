'use client';

/**
 * LiveNowSection — the auto-refreshing "what's happening right now" block on the
 * public event home. Two independent live inputs under one roof:
 *
 *   • Matches — the live board's own reader, `useLiveBoard` (seeded by the SSR
 *     snapshot so there's no flash): its poll and its realtime channel, and its
 *     word on how fresh the picture is, which the block shows when it is not live.
 *   • Workshops — have no realtime state; they move purely by the clock, so
 *     "live" / "starting soon" is a pure derivation off the shared `useClientClock`
 *     minute store, which also honours an active super-admin time simulation. The
 *     server-passed `nowIso` seeds the first paint so SSR and hydration agree.
 *
 * Renders `null` when nothing is live or upcoming — so completed / pre-event
 * pages stay clean, exactly like the server markup it replaced.
 */

import Link from 'next/link';
import { useMemo } from 'react';
import { formatInZone, localeToBcp47 } from '@myclash/time';
import { isLiveStatus } from '@myclash/types';
import { FreshnessChip, useClientClock } from '@myclash/ui';
import { getPublicApiUrl } from '@/lib/api-url';
import { useI18n } from '@myclash/next-i18n/client';
import { useLiveBoard, type LiveState } from '../../live/use-live-board';
import { highlightsOf } from '../_lib/live-highlights';
import type { PublicWorkshop } from '../_lib/public-event-data';
import { liveWorkshops, upcomingWorkshops } from '../_lib/live-workshops';
import { LiveMatchCard } from './LiveMatchCard';
import { WorkshopCard } from './WorkshopCard';

interface Props {
  eventSlug: string;
  /** The server's read of the live state, or null when it failed. */
  initialState: LiveState | null;
  workshops: PublicWorkshop[];
  tz: string;
  /** Server render time (ISO) — seeds the workshop clock so SSR and hydration agree. */
  nowIso: string;
}

export function LiveNowSection({ eventSlug, initialState, workshops, tz, nowIso }: Props) {
  const { t, locale } = useI18n();
  const tag = localeToBcp47(locale);
  const apiUrl = getPublicApiUrl();

  // ── Matches: seed from SSR, then the live board's reads (with the login). ─────
  const { state, freshness } = useLiveBoard(eventSlug, initialState);
  const highlights = highlightsOf(state);

  // Paused counts as live: the fighters are on the strip waiting to resume,
  // and dropping the card made pistes blink off the board on every halt.
  const liveMatches = highlights.filter((m) => isLiveStatus(m.status));
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
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-success">
              <span className="inline-block h-2 w-2 rounded-full bg-success motion-safe:animate-pulse" />
              {t('publicApp.eventHome.liveNow')}
            </h2>
            {/* Says nothing while live; says it when the scores may be old (quick win F5's rule). */}
            <FreshnessChip freshness={freshness} t={t} quietWhenLive />
          </div>
          <div className="flex flex-col gap-3">
            {liveMatches.map((m) => (
              <LiveMatchCard
                key={m.id}
                match={m}
                href={`/e/${eventSlug}/match/${m.id}`}
                pausedLabel={m.status === 'paused' ? t('publicApp.live.paused') : null}
                t={t}
              />
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
