'use client';

import { useEffect, useRef, useState } from 'react';
import { localeToBcp47, type AppLocale } from '@myclash/time';
import { getApiUrl } from '@/lib/api-url';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useRealtimeWithFallback } from '@/lib/supabase-browser';
import { useI18n } from '../../../../src/i18n/I18nProvider';

interface LiveMatch {
  id: string;
  matchNumberLabel: string;
  redFighterName: string | null;
  blueFighterName: string | null;
  scheduledAt: string | null;
  status: string;
  tournamentName: string | null;
}

interface LiveLiceState {
  lice: { id: string; name: string; sortOrder: number };
  runningMatch: LiveMatch | null;
  nextMatch: LiveMatch | null;
}

interface LiveState {
  currentBlock: { label: string; startTime: string; endTime: string; blockType: string } | null;
  nextBlock: { label: string; startTime: string } | null;
  lices: LiveLiceState[];
}

function formatTime(hhmm: string): string {
  return hhmm.slice(0, 5);
}

function scheduledTime(iso: string | null, locale: AppLocale): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(localeToBcp47(locale), {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function LiveBadge() {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-1.5 bg-danger text-danger-foreground text-xs font-bold px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-danger-foreground animate-pulse" />
      {t('publicApp.live.badge')}
    </span>
  );
}

function MatchCard({ match, label }: { match: LiveMatch; label: string }) {
  const { t, locale } = useI18n();
  const isLive = match.status === 'running';
  return (
    <div
      className={[
        'rounded-xl p-3 border',
        isLive ? 'bg-danger/10 border-danger/40' : 'bg-surface border-border',
      ].join(' ')}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted font-medium">{label}</span>
        {isLive ? (
          <LiveBadge />
        ) : match.scheduledAt ? (
          <span className="text-xs text-muted">{scheduledTime(match.scheduledAt, locale)}</span>
        ) : null}
      </div>
      <p className="text-sm font-bold text-foreground">{match.matchNumberLabel}</p>
      <p className="text-sm text-foreground-secondary mt-0.5">
        {match.redFighterName ?? '?'}{' '}
        <span className="text-muted text-xs">{t('scoring.liveMatch.versus')}</span>{' '}
        {match.blueFighterName ?? '?'}
      </p>
      {match.tournamentName && <p className="text-xs text-muted mt-1">{match.tournamentName}</p>}
    </div>
  );
}

export default function LivePage() {
  const { t, locale } = useI18n();
  const params = useParams<{ eventSlug: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { eventSlug } = params;
  const focusLiceId = searchParams.get('lice');

  const apiUrl = getApiUrl();
  const [state, setState] = useState<LiveState | null>(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchState() {
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventSlug}/live-state`, {
        cache: 'no-store',
      });
      if (res.ok) setState((await res.json()) as LiveState);
    } catch {
      // Keep last known state
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/events/${eventSlug}/live-state`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.ok) setState((await res.json()) as LiveState);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
      })
      .finally(() => setLoading(false));

    timerRef.current = setInterval(() => void fetchState(), 30_000);
    return () => {
      controller.abort();
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventSlug]);

  // Realtime: re-fetch when any match on the event's lices changes.
  // Flag-aware (disable_realtime kill-switch) + one channel with an in.()
  // filter instead of the previous one-channel-per-lice fan-out.
  const liceIds = (state?.lices ?? []).map((l) => l.lice.id);
  useRealtimeWithFallback({
    channelName: `live-lices-${eventSlug}`,
    table: 'matches',
    filter: `lice_id=in.(${liceIds.join(',')})`,
    event: 'UPDATE',
    enabled: liceIds.length > 0,
    onEvent: () => void fetchState(),
    onFallbackPoll: () => void fetchState(),
  });

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="w-8 h-8 border-2 border-muted border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  if (!state) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-center">
        <div>
          <p className="text-4xl mb-3">📅</p>
          <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground mb-2">
            {t('publicApp.live.scheduleUnavailableTitle')}
          </h1>
          <p className="text-muted text-sm">{t('publicApp.live.scheduleUnavailableBody')}</p>
        </div>
      </main>
    );
  }

  // ── Drill-down mode ────────────────────────────────────────────────────────
  if (focusLiceId) {
    const ls = state.lices.find((l) => l.lice.id === focusLiceId);
    if (!ls) {
      return (
        <main className="flex min-h-screen items-center justify-center px-4 text-center">
          <div>
            <p className="text-muted text-sm">{t('publicApp.live.liceNotFound')}</p>
            <button
              onClick={() => router.push(`/e/${eventSlug}/live`)}
              className="mt-4 text-sm text-accent hover:underline"
            >
              ← {t('publicApp.live.backToOverview')}
            </button>
          </div>
        </main>
      );
    }

    return (
      <main className="flex flex-col min-h-screen px-4 py-6 max-w-md mx-auto gap-4">
        <button
          onClick={() => router.push(`/e/${eventSlug}/live`)}
          className="text-sm text-muted hover:text-foreground flex items-center gap-1 self-start"
        >
          ← {t('publicApp.live.allPistes')}
        </button>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-1">
            {t('publicApp.live.piste')}
          </p>
          <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground">
            {ls.lice.name}
          </h1>
        </div>

        {state.currentBlock && (
          <p className="text-sm text-muted">
            {state.currentBlock.label} · {formatTime(state.currentBlock.startTime)}–
            {formatTime(state.currentBlock.endTime)}
          </p>
        )}

        {ls.runningMatch ? (
          <MatchCard match={ls.runningMatch} label={t('publicApp.live.nowFighting')} />
        ) : (
          <div className="rounded-xl p-4 bg-surface border border-border text-center">
            <p className="text-muted text-sm">{t('publicApp.live.noActiveMatch')}</p>
          </div>
        )}

        {ls.nextMatch && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
              {t('publicApp.live.upNext')}
            </p>
            <MatchCard match={ls.nextMatch} label={t('publicApp.live.next')} />
          </div>
        )}
      </main>
    );
  }

  // ── Overview mode ──────────────────────────────────────────────────────────
  const anyRunning = state.lices.some((l) => l.runningMatch !== null);

  return (
    <main className="flex flex-col min-h-screen px-4 py-6 max-w-2xl mx-auto gap-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-1">
            {t('publicApp.live.liveSchedule')}
          </p>
          {state.currentBlock ? (
            <>
              <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground">
                {state.currentBlock.label}
              </h1>
              <p className="text-sm text-muted mt-0.5">
                {formatTime(state.currentBlock.startTime)}–{formatTime(state.currentBlock.endTime)}
              </p>
            </>
          ) : state.nextBlock ? (
            <>
              <h1 className="font-display font-bold text-2xl sm:text-3xl text-muted">
                {t('publicApp.live.betweenSessions')}
              </h1>
              <p className="text-sm text-muted mt-0.5">
                {t('publicApp.live.nextBlock', {
                  label: state.nextBlock.label,
                  time: formatTime(state.nextBlock.startTime),
                })}
              </p>
            </>
          ) : (
            <h1 className="font-display font-bold text-2xl sm:text-3xl text-muted">
              {t('publicApp.live.noActiveSession')}
            </h1>
          )}
        </div>
        {anyRunning && <LiveBadge />}
      </div>

      {/* Lice grid */}
      {state.lices.length === 0 ? (
        <p className="text-muted text-sm">{t('publicApp.live.noPistesConfigured')}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {state.lices.map((ls) => (
            <Link
              key={ls.lice.id}
              href={`/e/${eventSlug}/live?lice=${ls.lice.id}`}
              className="rounded-xl bg-surface border border-border p-4 hover:border-muted transition-colors block"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-muted uppercase tracking-wide">
                  {ls.lice.name}
                </span>
                {ls.runningMatch && <LiveBadge />}
              </div>

              {ls.runningMatch ? (
                <div>
                  <p className="text-sm font-bold text-foreground">
                    {ls.runningMatch.matchNumberLabel}
                  </p>
                  <p className="text-sm text-foreground-secondary mt-0.5">
                    {ls.runningMatch.redFighterName ?? '?'}{' '}
                    <span className="text-muted text-xs">{t('scoring.liveMatch.versus')}</span>{' '}
                    {ls.runningMatch.blueFighterName ?? '?'}
                  </p>
                </div>
              ) : ls.nextMatch ? (
                <div>
                  <p className="text-xs text-muted mb-1">{t('publicApp.live.nextUp')}</p>
                  <p className="text-sm font-medium text-foreground-secondary">
                    {ls.nextMatch.matchNumberLabel}
                  </p>
                  <p className="text-sm text-muted">
                    {ls.nextMatch.redFighterName ?? '?'}{' '}
                    <span className="text-muted text-xs">{t('scoring.liveMatch.versus')}</span>{' '}
                    {ls.nextMatch.blueFighterName ?? '?'}
                  </p>
                  {ls.nextMatch.scheduledAt && (
                    <p className="text-xs text-muted mt-1">
                      {scheduledTime(ls.nextMatch.scheduledAt, locale)}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-muted text-sm">–</p>
              )}
            </Link>
          ))}
        </div>
      )}

      <p className="text-xs text-muted text-center">{t('publicApp.live.updatesAutomatically')}</p>
    </main>
  );
}
